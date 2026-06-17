import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flox.app',
  appName: 'FLOX',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    backgroundColor: '#f7f9fc',
  },
};

export default config;
