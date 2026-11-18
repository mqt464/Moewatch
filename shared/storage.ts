// Share app data only. Account tokens stay on the desktop server.
export const sharedKey = (key: string) => /^(moewatch-settings-v1|moewatch-library-v1|moewatch-anilist-\d+-v1|moewatch-autonext)$/.test(key);
