export const config = {
  app: {
    port: 4000,
    apiUrl: 'http://localhost:4000',
    otpExpiresMinutes: 10,
    jwtSecret: 'rSdvHUATkxNXQxhpIUGYqqNMNsHpoFAdsIny3oFF9ts=',
    jwtExpiresIn: '10h',
    refreshExpiresIn: '10h',
  },
  db: {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'Camaro@2053',
    database: 'cresco_local',
  },
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: 'help.cresco@gmail.com',
    pass: 'lnby dvyu kaep suhw',
    from: 'Cresco CRM <help.cresco@gmail.com>',
  },
};
