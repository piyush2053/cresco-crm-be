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
import resourcesRoutes from "./routes/resources.route.js";
import notificationsRoutes from "./routes/notifications.route.js";
import { startSchedulers } from "./services/scheduler.service.js";
import { config } from "./config.js";

const app = express();
app.use(cors("*"));
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => res.json({ message: "Cresco CRM API is running." }));
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/buyers", buyersRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/logistics", logisticsRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api", resourcesRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Server error." });
});

app.listen(config.app.port, () => {
  console.log(`Server started at http://localhost:${config.app.port}`);
  startSchedulers();
});
