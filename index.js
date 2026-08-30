import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials
} from 'discord.js';
import { BotDatabase } from './database/index.js';
import { loadConfig, loadNametags } from './utils/config.js';
import { loadFolderModules } from './utils/loader.js';
import { logger } from './utils/logger.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const loadedConfig = loadConfig(rootDir);
const token = process.env.DISCORD_TOKEN || loadedConfig.token;

if (!token) {
  throw new Error('Es wurde kein Discord-Token gefunden. Bitte setze DISCORD_TOKEN oder config.json.token.');
}

loadedConfig.token = token;

const nametags = loadNametags(rootDir);
const db = new BotDatabase(loadedConfig.databasePath);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.GuildMember,
    Partials.User
  ]
});

const commands = await loadFolderModules(path.join(rootDir, 'commands'));
const buttonHandlers = await loadFolderModules(path.join(rootDir, 'buttons'));
const selectHandlers = await loadFolderModules(path.join(rootDir, 'selectMenus'));
const modalHandlers = await loadFolderModules(path.join(rootDir, 'modals'));
const eventHandlers = await loadFolderModules(path.join(rootDir, 'events'));

const runtime = {
  rootDir,
  config: loadedConfig,
  nametags,
  db,
  commands: new Collection(commands.map((command) => [command.data.name, command])),
  buttonHandlers,
  selectHandlers,
  modalHandlers
};

runtime.refreshAllPanels = null;
runtime.refreshSupportLeaderboardPanel = null;
runtime.refreshDutyPanel = null;
runtime.refreshVerifyPanel = null;
runtime.refreshTeamListPanel = null;
runtime.refreshFlyPanel = null;
runtime.refreshAbsencePanel = null;
runtime.refreshActiveAbsencePanel = null;
runtime.syncOpenSupportCases = null;
runtime.syncExpiredAbsences = null;
runtime.syncWaitingRoomSupportCases = null;
runtime.startMaintenanceLoop = null;
runtime.stopMaintenanceLoop = null;

client.runtime = runtime;
client.commands = runtime.commands;
client.buttonHandlers = buttonHandlers;
client.selectHandlers = selectHandlers;
client.modalHandlers = modalHandlers;

for (const event of eventHandlers) {
  const register = event.once ? client.once.bind(client) : client.on.bind(client);
  register(event.name, (...args) => event.execute(...args, runtime));
}

client.on('error', (error) => {
  logger.error('Discord-Client-Fehler.', error);
});

client.on('shardError', (error) => {
  logger.error('Shard-Fehler.', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection.', error);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception.', error);
});

await client.login(token);
