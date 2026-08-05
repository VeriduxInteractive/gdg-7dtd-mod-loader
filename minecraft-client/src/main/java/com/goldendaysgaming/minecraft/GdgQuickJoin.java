package com.goldendaysgaming.minecraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Tooltip;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ServerStatusPinger;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.network.chat.Component;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.ScreenEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;
import net.minecraftforge.fml.loading.FMLPaths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.lang.reflect.Type;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

@Mod(GdgQuickJoin.MOD_ID)
public final class GdgQuickJoin {
    public static final String MOD_ID = "gdgquickjoin";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public GdgQuickJoin() {
        if (FMLEnvironment.dist == Dist.CLIENT) {
            MinecraftForge.EVENT_BUS.register(ClientEvents.class);
            LOGGER.info("Registered GDG Minecraft Quick Join for Otherworld v8 HF2");
        }
    }

    private static final class ClientEvents {
        private static final Map<Screen, QuickJoinPanel> PANELS = Collections.synchronizedMap(new WeakHashMap<>());

        @SubscribeEvent
        public static void onScreenInit(ScreenEvent.Init.Post event) {
            if (!(event.getScreen() instanceof TitleScreen titleScreen)) {
                return;
            }
            QuickJoinPanel previous = PANELS.remove(titleScreen);
            if (previous != null) {
                previous.close();
            }
            QuickJoinPanel panel = new QuickJoinPanel(titleScreen, ServerDirectory.load());
            panel.addWidgets(event);
            PANELS.put(titleScreen, panel);
            LOGGER.info("Attached GDG Quick Join to {}", titleScreen.getClass().getName());
        }

        @SubscribeEvent
        public static void onScreenRenderPre(ScreenEvent.Render.Pre event) {
            QuickJoinPanel panel = PANELS.get(event.getScreen());
            if (panel != null) {
                panel.renderBackground(event.getGuiGraphics());
            }
        }

        @SubscribeEvent
        public static void onScreenRenderPost(ScreenEvent.Render.Post event) {
            QuickJoinPanel panel = PANELS.get(event.getScreen());
            if (panel != null) {
                panel.renderForeground(event.getGuiGraphics());
            }
        }

        @SubscribeEvent
        public static void onClientTick(TickEvent.ClientTickEvent event) {
            if (event.phase != TickEvent.Phase.END) {
                return;
            }
            Screen screen = Minecraft.getInstance().screen;
            QuickJoinPanel active = screen == null ? null : PANELS.get(screen);
            if (active != null) {
                active.tick();
            }
        }

        @SubscribeEvent
        public static void onScreenClosing(ScreenEvent.Closing event) {
            QuickJoinPanel panel = PANELS.remove(event.getScreen());
            if (panel != null) {
                panel.close();
            }
        }
    }

    private static final class QuickJoinPanel {
        private static final int PANEL_WIDTH = 276;
        private static final int MINIMUM_PANEL_WIDTH = 190;
        private static final int HEADER_HEIGHT = 34;
        private static final int ROW_HEIGHT = 28;
        private static final int LEFT_MARGIN = 10;
        private static final long REPING_INTERVAL_MS = 30_000L;

        private final TitleScreen parent;
        private final List<ServerRow> rows = new ArrayList<>();
        private final ServerStatusPinger pinger = new ServerStatusPinger();
        private int x;
        private int y;
        private int width;
        private long nextPingAt;

        private QuickJoinPanel(TitleScreen parent, List<ServerEntry> servers) {
            this.parent = parent;
            for (ServerEntry entry : servers) {
                rows.add(new ServerRow(entry));
            }
        }

        private void addWidgets(ScreenEvent.Init.Post event) {
            width = Math.min(PANEL_WIDTH, Math.max(MINIMUM_PANEL_WIDTH, parent.width / 5));
            x = LEFT_MARGIN;
            y = Math.max(34, parent.height / 2 - 60);
            for (int index = 0; index < rows.size(); index++) {
                ServerRow row = rows.get(index);
                int buttonY = y + HEADER_HEIGHT + index * ROW_HEIGHT;
                row.button = Button.builder(Component.literal(row.entry.name()), ignored -> connect(row))
                    .bounds(x + 10, buttonY, width - 20, 22)
                    .tooltip(Tooltip.create(Component.literal(row.entry.description() + "\n" + row.entry.address())))
                    .build();
                event.addListener(row.button);
            }
            pingAll();
        }

        private void renderBackground(GuiGraphics graphics) {
            int height = HEADER_HEIGHT + rows.size() * ROW_HEIGHT + 8;
            graphics.fill(x, y, x + width, y + height, 0xC0121820);
            graphics.fill(x, y, x + 3, y + height, 0xFFFFB000);
        }

        private void renderForeground(GuiGraphics graphics) {
            Minecraft minecraft = Minecraft.getInstance();
            graphics.drawString(
                minecraft.font,
                Component.literal("GOLDEN DAYS SERVERS").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
                x + 12,
                y + 11,
                0xFFFFFFFF,
                true
            );
        }

        private void tick() {
            pinger.tick();
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
            pinger.removeAll();
            for (ServerRow row : rows) {
                row.beginPing();
                try {
                    pinger.pingServer(row.data, row::refreshLabel);
                } catch (UnknownHostException exception) {
                    row.markOffline();
                } catch (RuntimeException exception) {
                    LOGGER.debug("Could not start status ping for {}", row.entry.address(), exception);
                    row.markOffline();
                }
            }
        }

        private void close() {
            pinger.removeAll();
        }

        private void connect(ServerRow row) {
            Minecraft minecraft = Minecraft.getInstance();
            ServerAddress address = ServerAddress.parseString(row.entry.address());
            ConnectScreen.startConnecting(parent, minecraft, address, row.data, false);
        }
    }

    private static final class ServerRow {
        private final ServerEntry entry;
        private final ServerData data;
        private Button button;
        private boolean checking = true;
        private boolean online;
        private long pingStartedAt;

        private ServerRow(ServerEntry entry) {
            this.entry = entry;
            this.data = new ServerData(entry.name(), entry.address(), false);
        }

        private void beginPing() {
            checking = true;
            online = false;
            pingStartedAt = System.currentTimeMillis();
            data.pinged = false;
            data.ping = -2L;
            refreshLabel();
        }

        private void updateFromPing(long now) {
            if (checking && data.ping >= 0L) {
                checking = false;
                online = true;
            } else if (checking && now - pingStartedAt >= 6_000L) {
                checking = false;
                online = false;
            }
            refreshLabel();
        }

        private void markOffline() {
            checking = false;
            online = false;
            refreshLabel();
        }

        private void refreshLabel() {
            if (button == null) {
                return;
            }
            Component state;
            if (checking) {
                state = Component.literal("CHECKING").withStyle(ChatFormatting.YELLOW);
            } else if (online) {
                String players = data.status == null ? "" : "  " + data.status.getString();
                state = Component.literal("ONLINE" + players).withStyle(ChatFormatting.GREEN);
            } else {
                state = Component.literal("OFFLINE").withStyle(ChatFormatting.RED);
            }
            button.setMessage(Component.literal(entry.name() + "  •  ").append(state));
        }
    }

    private record ServerEntry(String id, String name, String address, String description) {
    }

    private static final class ServerDirectory {
        private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
        private static final Type SERVER_LIST_TYPE = new TypeToken<List<ServerEntry>>() { }.getType();
        private static final List<ServerEntry> DEFAULT_SERVERS = List.of(
            new ServerEntry(
                "gdg-minecraft-otherworld",
                "Otherworld v8 HF2",
                "goldendays.mcsh.io:25565",
                "Golden Days Gaming public Otherworld Dungeons & Dragons server"
            )
        );

        private static List<ServerEntry> load() {
            Path configPath = FMLPaths.CONFIGDIR.get().resolve("gdg-quick-join.json");
            try {
                if (Files.notExists(configPath)) {
                    Files.createDirectories(configPath.getParent());
                    Files.writeString(configPath, GSON.toJson(DEFAULT_SERVERS), StandardCharsets.UTF_8);
                    return DEFAULT_SERVERS;
                }
                List<ServerEntry> entries = GSON.fromJson(Files.readString(configPath, StandardCharsets.UTF_8), SERVER_LIST_TYPE);
                if (entries == null || entries.isEmpty()) {
                    return DEFAULT_SERVERS;
                }
                List<ServerEntry> valid = entries.stream()
                    .filter(entry -> entry != null && entry.name() != null && entry.address() != null)
                    .toList();
                return valid.isEmpty() ? DEFAULT_SERVERS : valid;
            } catch (IOException | RuntimeException exception) {
                LOGGER.warn("Could not load GDG Quick Join server list; using defaults", exception);
                return DEFAULT_SERVERS;
            }
        }
    }
}
