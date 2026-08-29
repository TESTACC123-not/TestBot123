import { openSupportCaseForMember } from '../utils/panels.js';
import { openWaitingRequestForMember, getWaitingRoomAreas } from '../utils/waitingRooms.js';
import { logger } from '../utils/logger.js';

export default {
  name: 'voiceStateUpdate',
  once: false,
  async execute(oldState, newState, runtime) {
    if (!newState.member || newState.member.user.bot) {
      return;
    }

    // Ein einziges Muster für alle Wartebereiche (Support, High Team, Leitung):
    // Jeder Bereich liest seinen Warteraum aus duty.areas.<bereich>.waitingChannelId.
    for (const { key: typeKey } of getWaitingRoomAreas(runtime)) {
      const roomConfig = runtime.config.duty?.areas?.[typeKey];
      const roomId = roomConfig?.waitingChannelId;
      if (!roomId) {
        continue;
      }

      // Nur auf Betreten reagieren (nicht auf Verlassen oder interne Wechsel).
      if (oldState.channelId === roomId || newState.channelId !== roomId) {
        continue;
      }

      if (typeKey === 'support') {
        await openSupportCaseForMember(newState.client, runtime, newState.member).catch((error) => {
          logger.error(`Supportfall für ${newState.member.id} konnte beim Betreten des Warteraums nicht erstellt werden.`, error);
        });
      } else {
        await openWaitingRequestForMember(newState.client, runtime, newState.member, typeKey).catch((error) => {
          logger.error(`Wartebereich ${typeKey}: Anliegen für ${newState.member.id} konnte beim Betreten nicht erstellt werden.`, error);
        });
      }
    }
  }
};
