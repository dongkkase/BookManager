export function shouldPlayCompletionSound(config = {}, successCount = 1, cancelled = false) {
    return config.play_sound !== false && Number(successCount) > 0 && !cancelled;
}
