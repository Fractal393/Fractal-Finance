import firebaseConfig from '../../firebase-applet-config.json';

export const environment = {
  production: false,
  firebase: {
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
  },
};
