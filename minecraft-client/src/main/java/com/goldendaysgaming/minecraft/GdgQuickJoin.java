package com.goldendaysgaming.minecraft;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiButton;
import net.minecraft.client.gui.GuiMainMenu;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.multiplayer.GuiConnecting;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.util.text.TextFormatting;
import net.minecraftforge.client.event.GuiOpenEvent;
import net.minecraftforge.client.event.GuiScreenEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Loader;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.ObfuscationReflectionHelper;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Type;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

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
    public static final String VERSION = "0.2.1";
    private static final Logger LOGGER = LogManager.getLogger(MOD_ID);

    @Mod.EventHandler
    public void initialize(FMLInitializationEvent event) {
        MinecraftForge.EVENT_BUS.register(new ClientEvents());
        LOGGER.info("Registered GDG Minecraft Quick Join title-screen hooks");
    }

    private static final class ClientEvents {
        private static final Field BUTTON_LIST_FIELD = ObfuscationReflectionHelper.findField(
            GuiScreen.class,
            "field_146292_n"
        );
        private QuickJoinPanel activePanel;

        @SubscribeEvent
        public void onGuiInit(GuiScreenEvent.InitGuiEvent.Post event) {
            if (!isSupportedTitleScreen(event.getGui())) {
                return;
            }

            attachTo(event.getGui(), event.getButtonList(), "menu initialization");
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

            // Custom Main Menu can create Stoneblock's title screen before Forge reaches
            // this mod's initialization event. In that case InitGuiEvent has already fired,
            // so attach from the client tick as soon as the existing screen is visible.
            if (isSupportedTitleScreen(current)) {
                List<GuiButton> buttonList = getButtonList(current);
                if (activePanel == null) {
                    attachTo(current, buttonList, "client tick fallback");
                }
                activePanel.ensureButtons(buttonList);
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

        private void attachTo(GuiScreen screen, List<GuiButton> buttonList, String source) {
            closePanel();
            activePanel = new QuickJoinPanel(screen, ServerDirectory.load());
            activePanel.addButtons(buttonList);
            LOGGER.info("Attached GDG Quick Join to {} via {}", screen.getClass().getName(), source);
        }

        @SuppressWarnings("unchecked")
        private static List<GuiButton> getButtonList(GuiScreen screen) {
            try {
                return (List<GuiButton>) BUTTON_LIST_FIELD.get(screen);
            } catch (IllegalAccessException exception) {
                throw new IllegalStateException("Could not access the Minecraft title-screen button list", exception);
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
        private static final int RIGHT_MARGIN = 10;
        private static final int CUSTOM_MENU_RIGHT_RAIL_WIDTH = 42;
        private static final int BUTTON_ID_BASE = 17820;
        private static final long REPING_INTERVAL_MS = 30_000L;

        private final GuiScreen parent;
        private final List<ServerRow> rows = new ArrayList<ServerRow>();
        private final ProtocolStatusPinger pinger = new ProtocolStatusPinger();
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
            int rightRail = parent.getClass().getName().startsWith("lumien.custommainmenu.gui.")
                ? CUSTOM_MENU_RIGHT_RAIL_WIDTH
                : 0;
            x = parent.width - width - RIGHT_MARGIN - rightRail;
            y = 34;

            for (int index = 0; index < rows.size(); index++) {
                ServerRow row = rows.get(index);
                int buttonY = y + HEADER_HEIGHT + index * ROW_HEIGHT;
                row.button = new GuiButton(BUTTON_ID_BASE + index, x + 10, buttonY, width - 20, 22, row.entry.name);
            }

            ensureButtons(buttonList);
            pingAll();
        }

        private void ensureButtons(List<GuiButton> buttonList) {
            for (ServerRow row : rows) {
                if (row.button != null && !buttonList.contains(row.button)) {
                    buttonList.add(row.button);
                }
            }
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

            for (ServerRow row : rows) {
                row.beginPing(pinger);
            }
        }

        private void handleButton(GuiButton button) {
            for (ServerRow row : rows) {
                if (row.button == button) {
                    Minecraft minecraft = Minecraft.getMinecraft();
                    minecraft.displayGuiScreen(new GuiConnecting(parent, minecraft, row.data));
                    return;
                }
            }
        }

        private void close() {
            pinger.close();
        }
    }

    private static final class ServerRow {
        private final ServerEntry entry;
        private final ServerData data;
        private GuiButton button;
        private boolean checking = true;
        private boolean online;
        private String error = "";
        private String population = "";
        private long pingStartedAt;
        private int pingAttempt;

        private ServerRow(ServerEntry entry) {
            this.entry = entry;
            this.data = new ServerData(entry.name, entry.address, false);
        }

        private void beginPing(ProtocolStatusPinger pinger) {
            checking = true;
            online = false;
            error = "";
            population = "";
            pingStartedAt = System.currentTimeMillis();
            pingAttempt++;
            refreshLabel();
            pinger.ping(this, pingAttempt);
        }

        private void updateFromPing(long now) {
            if (checking && now - pingStartedAt >= 6_000L) {
                pingAttempt++;
                checking = false;
                online = false;
                error = "Timed out";
            }
            refreshLabel();
        }

        private void completePing(int attempt, StatusResult result) {
            if (attempt != pingAttempt) {
                return;
            }
            checking = false;
            online = result.online;
            population = result.population;
            error = result.error;
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
                String players = population.isEmpty() ? "" : "  " + population;
                state = TextFormatting.GREEN + "ONLINE" + players;
            } else {
                state = TextFormatting.RED + "OFFLINE";
            }
            button.displayString = entry.name + TextFormatting.RESET + "  •  " + state;
        }
    }

    private static final class ProtocolStatusPinger {
        private static final int MINECRAFT_1_12_2_PROTOCOL = 340;
        private static final int DEFAULT_PORT = 25565;
        private static final int TIMEOUT_MS = 5_000;
        private static final int MAXIMUM_STATUS_BYTES = 1_048_576;
        private static final AtomicInteger THREAD_NUMBER = new AtomicInteger();

        private final ExecutorService executor = Executors.newFixedThreadPool(2, new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "GDG-Quick-Join-Ping-" + THREAD_NUMBER.incrementAndGet());
                thread.setDaemon(true);
                return thread;
            }
        });
        private volatile boolean closed;

        private void ping(final ServerRow row, final int attempt) {
            try {
                executor.submit(new Runnable() {
                    @Override
                    public void run() {
                        final StatusResult result = query(row.entry.address);
                        if (closed) {
                            return;
                        }
                        Minecraft.getMinecraft().addScheduledTask(new Runnable() {
                            @Override
                            public void run() {
                                if (!closed) {
                                    row.completePing(attempt, result);
                                }
                            }
                        });
                    }
                });
            } catch (RejectedExecutionException exception) {
                row.completePing(attempt, StatusResult.offline("Status checker stopped"));
            }
        }

        private void close() {
            closed = true;
            executor.shutdownNow();
        }

        private static StatusResult query(String address) {
            HostAndPort target;
            try {
                target = HostAndPort.parse(address);
            } catch (RuntimeException exception) {
                return StatusResult.offline("Invalid address");
            }

            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(target.host, target.port), TIMEOUT_MS);
                socket.setSoTimeout(TIMEOUT_MS);

                DataInputStream input = new DataInputStream(socket.getInputStream());
                DataOutputStream output = new DataOutputStream(socket.getOutputStream());
                writeHandshake(output, target);
                writeVarInt(output, 1);
                writeVarInt(output, 0);
                output.flush();

                int packetLength = readVarInt(input);
                int packetId = readVarInt(input);
                int jsonLength = readVarInt(input);
                if (packetLength <= 0 || packetLength > MAXIMUM_STATUS_BYTES || packetId != 0
                    || jsonLength <= 0 || jsonLength > MAXIMUM_STATUS_BYTES) {
                    return StatusResult.offline("Invalid status response");
                }

                byte[] jsonBytes = new byte[jsonLength];
                input.readFully(jsonBytes);
                JsonObject response = new JsonParser()
                    .parse(new String(jsonBytes, StandardCharsets.UTF_8))
                    .getAsJsonObject();
                JsonObject players = response.getAsJsonObject("players");
                if (players == null || !players.has("online") || !players.has("max")) {
                    return StatusResult.online("");
                }
                return StatusResult.online(
                    players.get("online").getAsInt() + "/" + players.get("max").getAsInt()
                );
            } catch (Exception exception) {
                LOGGER.debug("GDG Quick Join status query failed for {}", address, exception);
                return StatusResult.offline(exception.getClass().getSimpleName());
            } finally {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // The status result is already final; socket cleanup cannot change it.
                }
            }
        }

        private static void writeHandshake(DataOutputStream output, HostAndPort target) throws IOException {
            ByteArrayOutputStream packetBytes = new ByteArrayOutputStream();
            DataOutputStream packet = new DataOutputStream(packetBytes);
            writeVarInt(packet, 0);
            writeVarInt(packet, MINECRAFT_1_12_2_PROTOCOL);
            byte[] hostBytes = target.host.getBytes(StandardCharsets.UTF_8);
            writeVarInt(packet, hostBytes.length);
            packet.write(hostBytes);
            packet.writeShort(target.port);
            writeVarInt(packet, 1);
            packet.flush();

            writeVarInt(output, packetBytes.size());
            packetBytes.writeTo(output);
        }

        private static void writeVarInt(OutputStream output, int value) throws IOException {
            do {
                int current = value & 0x7F;
                value >>>= 7;
                if (value != 0) {
                    current |= 0x80;
                }
                output.write(current);
            } while (value != 0);
        }

        private static int readVarInt(InputStream input) throws IOException {
            int value = 0;
            int position = 0;
            int current;
            do {
                current = input.read();
                if (current < 0) {
                    throw new EOFException("Server closed the status response early");
                }
                value |= (current & 0x7F) << position;
                position += 7;
                if (position >= 35) {
                    throw new IOException("Status response VarInt is too large");
                }
            } while ((current & 0x80) != 0);
            return value;
        }
    }

    private static final class StatusResult {
        private final boolean online;
        private final String population;
        private final String error;

        private StatusResult(boolean online, String population, String error) {
            this.online = online;
            this.population = population;
            this.error = error;
        }

        private static StatusResult online(String population) {
            return new StatusResult(true, population, "");
        }

        private static StatusResult offline(String error) {
            return new StatusResult(false, "", error);
        }
    }

    private static final class HostAndPort {
        private final String host;
        private final int port;

        private HostAndPort(String host, int port) {
            this.host = host;
            this.port = port;
        }

        private static HostAndPort parse(String address) {
            String value = address == null ? "" : address.trim();
            if (value.isEmpty()) {
                throw new IllegalArgumentException("Address is empty");
            }

            String host = value;
            int port = ProtocolStatusPinger.DEFAULT_PORT;
            if (value.startsWith("[")) {
                int bracket = value.indexOf(']');
                if (bracket < 0) {
                    throw new IllegalArgumentException("Invalid IPv6 address");
                }
                host = value.substring(1, bracket);
                if (bracket + 1 < value.length()) {
                    if (value.charAt(bracket + 1) != ':') {
                        throw new IllegalArgumentException("Invalid address suffix");
                    }
                    port = Integer.parseInt(value.substring(bracket + 2));
                }
            } else {
                int colon = value.lastIndexOf(':');
                if (colon > 0 && colon == value.indexOf(':')) {
                    host = value.substring(0, colon);
                    port = Integer.parseInt(value.substring(colon + 1));
                }
            }

            if (host.isEmpty() || port < 1 || port > 65_535) {
                throw new IllegalArgumentException("Invalid host or port");
            }
            return new HostAndPort(host, port);
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
