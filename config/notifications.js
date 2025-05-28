const { Expo } = require('expo-server-sdk');

// Configuration des notifications push
const notificationConfig = {
  expo: new Expo({
    accessToken: 'BBDBz7MhVQBCq96RpAASWO_6S99-GZPiJK0XA-VCrN7aWF433VvfMgEjcfRK0kes303ELmVr59-nUcsCI1O2Lss',
    privateKey: 'rseLvEXYmexlzJGo0Ym55uagMsAmwaaNFO6OjHK_BFs',
    useFcmV1: true,
    retryCount: 3,
    timeout: 10000
  }),

  // Configuration des canaux de notification Android
  androidChannels: {
    default: {
      name: 'default',
      importance: 'max',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default'
    },
    high: {
      name: 'high',
      importance: 'max',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default'
    }
  },

  // Configuration des icônes
  icons: {
    android: {
      smallIcon: '@mipmap/ic_launcher',
      largeIcon: '@mipmap/ic_launcher'
    },
    ios: {
      icon: '@mipmap/ic_launcher'
    }
  },

  // Configuration des couleurs par type de notification
  colors: {
    request: '#2196F3',    // Bleu pour les demandes
    approval: '#4CAF50',   // Vert pour les approbations
    rejection: '#F44336',  // Rouge pour les rejets
    payment: '#4CAF50',    // Vert pour les paiements
    update: '#FF9800',     // Orange pour les mises à jour
    delete: '#F44336'      // Rouge pour les suppressions
  },

  // Configuration des priorités
  priorities: {
    high: 'high',
    default: 'default'
  }
};

module.exports = notificationConfig; 