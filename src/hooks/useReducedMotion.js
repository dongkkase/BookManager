import { useSyncExternalStore } from 'react';
import { isMotionReduced, subscribeMotionPreference } from '../motionPolicy.js';

export function useReducedMotion() {
    return useSyncExternalStore(subscribeMotionPreference, isMotionReduced, () => false);
}
