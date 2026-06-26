export function shouldPlayCompletionSound(config = {}, completedCount = 1, cancelled = false) {
    return config.play_sound !== false && Number(completedCount) > 0 && !cancelled;
}
