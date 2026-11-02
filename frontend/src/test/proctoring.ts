import type { ClientRules, ProctorConfig, ProctorModule } from '@/services/proctoringService'

/** Client rules / config fixtures for tests of the proctored student flows. */
export function clientRules(over: Partial<ClientRules> = {}): ClientRules {
  return {
    camera_required: true, mic_required: false, fullscreen_required: false, detect_multiple_faces: true, detect_looking_away: false,
    detect_objects: false, detect_voice: false,
    durations_ms: { NO_FACE: 8000, MULTIPLE_FACES: 3000, LOOKING_AWAY: 8000, CAMERA_BLOCKED: 5000, WINDOW_BLUR: 3000, VOICE_DETECTED: 5000 },
    voice_db: 18, object_min_confidence: 0.6, heartbeat_seconds: 10, face_fps: 2, object_fps: 0.5,
    labels: { NO_FACE: 'Face not visible', MULTIPLE_FACES: 'More than one person in view', TAB_HIDDEN: 'Switched tab or minimised the window' },
    ...over,
  }
}

export function proctorConfig(enabled: boolean, module: ProctorModule = 'ONLINE_TEST', rules: Partial<ClientRules> = {}): ProctorConfig {
  return {
    module, enabled, rules_version: '2026-11-v1', acknowledgement: 'I have read and understood all examination rules and instructions.',
    rules: ['Keep your face visible throughout the examination.', 'Ensure adequate lighting.', 'Do not leave the examination window.'],
    notice: { captured: ['Proctoring flags'], not_captured: ['No video, photos or images'], where: 'On this device.', who_sees: 'Your teacher.', retention: '180 days.' },
    client_rules: clientRules(rules),
  }
}
