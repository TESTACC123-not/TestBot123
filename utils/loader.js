import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { logger } from './logger.js';

export async function loadFolderModules(folderPath) {
  if (!fs.existsSync(folderPath)) {
    return [];
  }

  const entries = fs
    .readdirSync(folderPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .sort((left, right) => left.name.localeCompare(right.name));

  const modules = [];
  for (const entry of entries) {
    const moduleUrl = pathToFileURL(path.join(folderPath, entry.name)).href;
    const imported = await import(moduleUrl);
    const exported = imported.default ?? imported;
    if (Array.isArray(exported)) {
      modules.push(...exported);
    } else {
      modules.push(exported);
    }
  }

  return modules;
}

export async function registerSlashCommands(runtime) {
  const { config, commands } = runtime;

  if (!config.registerCommandsOnStartup) {
    return;
  }

  if (!config.clientId || !config.guildId) {
    logger.warn('Slash-Command-Registrierung übersprungen, weil clientId oder guildId fehlt.');
    return;
  }

  const body = Array.from(commands.values()).map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(config.token);

  logger.info(`Registriere ${body.length} Slash-Commands für den Guild-Scopes...`);
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
  logger.info('Slash-Commands erfolgreich registriert.');
}
