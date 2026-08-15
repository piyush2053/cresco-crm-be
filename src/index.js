import "./async-errors.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.route.js";
import usersRoutes from "./routes/users.route.js";
import rolesRoutes from "./routes/roles.route.js";
import buyersRoutes from "./routes/buyers.route.js";
import suppliersRoutes from "./routes/suppliers.route.js";
import logisticsRoutes from "./routes/logistics.route.js";
import uploadsRoutes from "./routes/uploads.route.js";
import reportsRoutes from "./routes/reports.route.js";
import notificationsRoutes from "./routes/notifications.route.js";
import ordersRoutes from "./routes/orders.route.js";
import financeRoutes from "./routes/finance.route.js";
import settingsRoutes from "./routes/settings.route.js";
import searchRoutes from "./routes/search.route.js";
import productsRoutes, { publicProductsRouter } from "./routes/products.route.js";
import { startSchedulers } from "./services/scheduler.service.js";
import { config } from "./config.js";

const app = express();
const allowedOrigins = new Set(config.app.corsOrigins);
app.set("trust proxy", 1);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has("*") || allowedOrigins.has(origin)) return callback(null, true);
    const error = new Error("This website is not allowed to access the CRM API.");
    error.status = 403;
    return callback(error);
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use("/product-assets", express.static(config.productAssets.directory, { fallthrough: false, index: false }));

app.get("/", (req, res) => res.json({ message: "Cresco CRM API is running. V1.3" }));
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/buyers", buyersRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/logistics", logisticsRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/public", publicProductsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  if(res.headersSent)return next(err);
  const known={
    "23505":[409,"This record already exists. Please use a unique value."],
    "23503":[409,"This record is linked to other data and cannot be changed or removed."],
    "23502":[400,"A required field is missing."],
    "23514":[400,"The supplied value does not satisfy the business rules."],
    "22P02":[400,"One or more values have an invalid format."],
    "22007":[400,"The supplied date or time is invalid."],
    "22008":[400,"The supplied date or time is outside the valid range."]
  };
  const mapped=known[err.code];
  const validation=!err.code&&/invalid|required|unknown|unsupported|select|no worksheet/i.test(err.message||"");
  const missing=!err.code&&/not found/i.test(err.message||"");
  const status=mapped?.[0]||err.status||err.statusCode||(missing?404:validation?400:500);
  const safeMessage=mapped?.[1]||(status<500?err.message:"The server could not complete this request. Please try again.");
  res.status(status).json({message:safeMessage,code:err.code||"INTERNAL_ERROR"});
});

app.listen(config.app.port, () => {
  console.log(`Server started at http://localhost:${config.app.port}`);
  startSchedulers();
});
