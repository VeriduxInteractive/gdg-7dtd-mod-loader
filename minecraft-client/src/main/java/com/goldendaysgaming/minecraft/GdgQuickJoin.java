package com.goldendaysgaming.minecraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiButton;
import net.minecraft.client.gui.GuiMainMenu;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.network.ServerPinger;
import net.minecraft.util.text.TextFormatting;
import net.minecraftforge.client.event.GuiOpenEvent;
import net.minecraftforge.client.event.GuiScreenEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.client.FMLClientHandler;
import net.minecraftforge.fml.common.Loader;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;

import java.io.IOException;
import java.lang.reflect.Type;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@Mod(
    modid = GdgQuickJoin.MOD_ID,
    name = GdgQuickJoin.MOD_NAME,
    version = GdgQuickJoin.VERSION,
    acceptedMinecraftVersions = "[1.12.2]",
    acceptableRemoteVersions = "*",
    clientSideOnly = true
)
public final class GdgQuickJoin {
    public static final String MOD_ID = "gdgquickjoin";
    public static final String MOD_NAME = "GDG Minecraft Quick Join";
    public static final String VERSION = "0.2.0";

    @Mod.EventHandler
    public void initialize(FMLInitializationEvent event) {
        MinecraftForge.EVENT_BUS.register(new ClientEvents());
    }

    private static final class ClientEvents {
        private QuickJoinPanel activePanel;

        @SubscribeEvent
        public void onGuiInit(GuiScreenEvent.InitGuiEvent.Post event) {
            if (!isSupportedTitleScreen(event.getGui())) {
                return;
            }

            closePanel();
            activePanel = new QuickJoinPanel(event.getGui(), ServerDirectory.load());
            activePanel.addButtons(event.getButtonList());
        }

        @SubscribeEvent
        public void onGuiDraw(GuiScreenEvent.DrawScreenEvent.Post event) {
            if (activePanel != null && activePanel.belongsTo(event.getGui())) {
                activePanel.draw(event.getMouseX(), event.getMouseY(), event.getRenderPartialTicks());
            }
        }

        @SubscribeEvent
        public void onButtonPressed(GuiScreenEvent.ActionPerformedEvent.Post event) {
            if (activePanel != null && activePanel.belongsTo(event.getGui())) {
                activePanel.handleButton(event.getButton());
            }
        }

        @SubscribeEvent
        public void onClientTick(TickEvent.ClientTickEvent event) {
            if (event.phase != TickEvent.Phase.END) {
                return;
            }

            GuiScreen current = Minecraft.getMinecraft().currentScreen;
            if (activePanel != null && !activePanel.belongsTo(current)) {
                closePanel();
            }
            if (activePanel != null) {
                activePanel.tick();
            }
        }

        @SubscribeEvent
        public void onGuiOpen(GuiOpenEvent event) {
            if (activePanel != null && !activePanel.belongsTo(event.getGui())) {
                closePanel();
            }
        }

        private void closePanel() {
            if (activePanel != null) {
                activePanel.close();
                activePanel = null;
            }
        }

        private static boolean isSupportedTitleScreen(GuiScreen gui) {
            if (gui instanceof GuiMainMenu) {
                return true;
            }
            String className = gui == null ? "" : gui.getClass().getName();
            return "lumien.custommainmenu.gui.GuiCustom".equals(className)
                || "lumien.custommainmenu.gui.GuiFakeMain".equals(className);
        }
    }

    private static final class QuickJoinPanel {
        private static final int PANEL_WIDTH = 276;
        private static final int HEADER_HEIGHT = 34;
        private static final int ROW_HEIGHT = 28;
        private static final int BUTTON_ID_BASE = 17820;
        private static final long REPING_INTERVAL_MS = 30_000L;

        private final GuiScreen parent;
        private final List<ServerRow> rows = new ArrayList<ServerRow>();
        private final ServerPinger pinger = new ServerPinger();
        private int x;
        private int y;
        private int width;
        private long nextPingAt;

        private QuickJoinPanel(GuiScreen parent, List<ServerEntry> servers) {
            this.parent = parent;
            for (ServerEntry entry : servers) {
                rows.add(new ServerRow(entry));
            }
        }

        private boolean belongsTo(GuiScreen screen) {
            return parent == screen;
        }

        private void addButtons(List<GuiButton> buttonList) {
            width = Math.min(PANEL_WIDTH, Math.max(220, parent.width / 3));
            x = parent.width - width - 10;
            y = 34;

            for (int index = 0; index < rows.size(); index++) {
                ServerRow row = rows.get(index);
                int buttonY = y + HEADER_HEIGHT + index * ROW_HEIGHT;
                row.button = new GuiButton(BUTTON_ID_BASE + index, x + 10, buttonY, width - 20, 22, row.entry.name);
                buttonList.add(row.button);
            }

            pingAll();
        }

        private void draw(int mouseX, int mouseY, float partialTicks) {
            Minecraft minecraft = Minecraft.getMinecraft();
            int height = HEADER_HEIGHT + rows.size() * ROW_HEIGHT + 8;
            Gui.drawRect(x, y, x + width, y + height, 0xC0121820);
            Gui.drawRect(x, y, x + 3, y + height, 0xFFFFB000);
            minecraft.fontRenderer.drawStringWithShadow(
                TextFormatting.GOLD.toString() + TextFormatting.BOLD + "GOLDEN DAYS SERVERS",
                x + 12,
                y + 11,
                0xFFFFFF
            );

            for (ServerRow row : rows) {
                if (row.button != null) {
                    row.button.drawButton(minecraft, mouseX, mouseY, partialTicks);
                }
            }
        }

        private void tick() {
            pinger.pingPendingNetworks();
            long now = System.currentTimeMillis();
            for (ServerRow row : rows) {
                row.updateFromPing(now);
            }
            if (now >= nextPingAt) {
                pingAll();
            }
        }

        private void pingAll() {
            nextPingAt = System.currentTimeMillis() + REPING_INTERVAL_MS;
            pinger.clearPendingNetworks();

            for (ServerRow row : rows) {
                row.beginPing();
                try {
                    pinger.ping(row.data);
                } catch (UnknownHostException exception) {
                    row.markOffline("Unknown host");
                }
            }
        }

        private void handleButton(GuiButton button) {
            for (ServerRow row : rows) {
                if (row.button == button) {
                    FMLClientHandler.instance().connectToServer(parent, row.data);
                    return;
                }
            }
        }

        private void close() {
            pinger.clearPendingNetworks();
        }
    }

    private static final class ServerRow {
        private final ServerEntry entry;
        private final ServerData data;
        private GuiButton button;
        private boolean checking = true;
        private boolean online;
        private String error = "";
        private long pingStartedAt;

        private ServerRow(ServerEntry entry) {
            this.entry = entry;
            this.data = new ServerData(entry.name, entry.address, false);
        }

        private void beginPing() {
            checking = true;
            online = false;
            error = "";
            pingStartedAt = System.currentTimeMillis();
            data.pinged = false;
            data.pingToServer = -2L;
            refreshLabel();
        }

        private void updateFromPing(long now) {
            if (checking && data.pingToServer >= 0L) {
                checking = false;
                online = true;
            } else if (checking && now - pingStartedAt >= 5_000L) {
                checking = false;
                online = false;
                error = data.serverMOTD == null ? "Timed out" : data.serverMOTD;
            }
            refreshLabel();
        }

        private void markOffline(String reason) {
            checking = false;
            online = false;
            error = reason;
            refreshLabel();
        }

        private void refreshLabel() {
            if (button == null) {
                return;
            }

            String state;
            if (checking) {
                state = TextFormatting.YELLOW + "CHECKING";
            } else if (online) {
                String players = data.populationInfo == null ? "" : "  " + data.populationInfo;
                state = TextFormatting.GREEN + "ONLINE" + players;
            } else {
                state = TextFormatting.RED + "OFFLINE";
            }
            button.displayString = entry.name + TextFormatting.RESET + "  •  " + state;
        }
    }

    private static final class ServerEntry {
        private String id;
        private String name;
        private String address;
        private String description;

        private ServerEntry(String id, String name, String address, String description) {
            this.id = id;
            this.name = name;
            this.address = address;
            this.description = description;
        }
    }

    private static final class ServerDirectory {
        private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
        private static final Type SERVER_LIST_TYPE = new TypeToken<List<ServerEntry>>() { }.getType();
        private static final List<ServerEntry> DEFAULT_SERVERS = Collections.unmodifiableList(Arrays.asList(
            new ServerEntry(
                "gdg-minecraft-superior",
                "Stoneblock 2",
                "goldendays.mcsh.io:25565",
                "Golden Days Gaming public Stoneblock 2 server"
            )
        ));

        private static List<ServerEntry> load() {
            Path configPath = Loader.instance().getConfigDir().toPath().resolve("gdg-quick-join.json");
            try {
                if (Files.notExists(configPath)) {
                    Files.createDirectories(configPath.getParent());
                    Files.write(configPath, GSON.toJson(DEFAULT_SERVERS).getBytes(StandardCharsets.UTF_8));
                    return DEFAULT_SERVERS;
                }

                String json = new String(Files.readAllBytes(configPath), StandardCharsets.UTF_8);
                List<ServerEntry> entries = GSON.fromJson(json, SERVER_LIST_TYPE);
                if (entries == null || entries.isEmpty()) {
                    return DEFAULT_SERVERS;
                }
                List<ServerEntry> valid = new ArrayList<ServerEntry>();
                for (ServerEntry entry : entries) {
                    if (entry != null && entry.name != null && entry.address != null) {
                        valid.add(entry);
                    }
                }
                return valid.isEmpty() ? DEFAULT_SERVERS : valid;
            } catch (IOException exception) {
                return DEFAULT_SERVERS;
            } catch (RuntimeException exception) {
                return DEFAULT_SERVERS;
            }
        }
    }
}
