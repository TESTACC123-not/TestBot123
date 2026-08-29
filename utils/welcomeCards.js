import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AttachmentBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags
} from 'discord.js';
import { logger } from './logger.js';

const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const welcomeBannerPath = path.join(assetsDir, 'welcome-banner.gif');
const goodbyeBannerPath = path.join(assetsDir, 'goodbye-banner.gif');

function buildBannerAttachment(bannerPath, fileName, warningLabel) {
  if (!fs.existsSync(bannerPath)) {
    logger.warn(`${warningLabel}: Banner-Datei fehlt unter ${bannerPath}. Nachricht wird ohne Bild gesendet.`);
    return null;
  }

  return new AttachmentBuilder(bannerPath, { name: fileName });
}

export function buildWelcomeCard(member, template) {
  const attachment = buildBannerAttachment(welcomeBannerPath, 'welcome-banner.gif', 'Willkommensnachricht');

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${member.user.username}**`),
      new TextDisplayBuilder().setContent('🎉 **Herzlich Willkommen auf München RP | VC 🇩🇪 🎙️**')
    )
    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: member.displayAvatarURL({ size: 256 }) } }));

  const container = new ContainerBuilder()
    .setAccentColor(0x57f287)
    .addSectionComponents(headerSection)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `Willkommen ${member.toString()}, schön dass du da bist!`,
          '',
          `> ${template}`,
          '',
          `👥 **Mitglied Nr. ${member.guild.memberCount}**`
        ].join('\n')
      )
    );

  if (attachment) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://welcome-banner.gif')
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# München RP | VC · Willkommen · ${new Date().toLocaleString('de-DE')}`)
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: attachment ? [attachment] : [],
    allowedMentions: { users: [member.id], roles: [], repliedUser: false }
  };
}

export function buildGoodbyeCard(member, template) {
  const attachment = buildBannerAttachment(goodbyeBannerPath, 'goodbye-banner.gif', 'Verabschiedungsnachricht');

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${member.user.username}**`),
      new TextDisplayBuilder().setContent('👋 **Auf Wiedersehen!**')
    )
    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: member.displayAvatarURL({ size: 256 }) } }));

  const container = new ContainerBuilder()
    .setAccentColor(0xed4245)
    .addSectionComponents(headerSection)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [`Auf Wiedersehen ${member.toString()}, wir wünschen dir alles Gute!`, '', `> ${template}`].join('\n')
      )
    );

  if (attachment) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://goodbye-banner.gif')
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# München RP | VC · Auf Wiedersehen · ${new Date().toLocaleString('de-DE')}`)
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    files: attachment ? [attachment] : [],
    allowedMentions: { users: [member.id], roles: [], repliedUser: false }
  };
}
