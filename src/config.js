const production = process.env.NODE_ENV === "production";

function value(name, fallback = "") {
  const result = process.env[name] ?? fallback;
  if (production && result === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return result;
}

function numberValue(name, fallback) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

export const config = {
  app: {
    port: numberValue("PORT", 4000),
    apiUrl: value("API_URL", "http://localhost:4000"),
    frontendUrl: value("FRONTEND_URL", "http://localhost:5173"),
    corsOrigins: value("CORS_ORIGINS", "http://localhost:5173, http://localhost:5174",)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    otpExpiresMinutes: 10,
    jwtSecret: value("JWT_SECRET", "local-development-only-change-me"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "10h",
    refreshExpiresIn: process.env.REFRESH_EXPIRES_IN || "10h",
  },
  db: {
    host: value("DB_HOST", "localhost"),
    port: numberValue("DB_PORT", 5432),
    user: value("DB_USER", "postgres"),
    password: value("DB_PASSWORD"),
    database: value("DB_NAME", "cresco_local"),
  },
  smtp: {
    host: value("SMTP_HOST", "smtp.gmail.com"),
    port: numberValue("SMTP_PORT", 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: value("SMTP_USER"),
    pass: value("SMTP_PASS"),
    from: value("SMTP_FROM", "Cresco CRM <help.cresco@gmail.com>"),
  },
  productAssets: {
    directory: "/app/product-assets",
    publicUrl: "https://msl.rnj.mybluehost.me/product-assets",
  },
};
