
import { AuthService } from "../services/auth.service.js";
import { ActivityService } from "../services/activity.service.js";

export const AuthController = {
  async login(req, res) {
    const { email, password } = req.body;
    const result = await AuthService.login(email, password);
    return res.status(result.status).json(result.body);
  },

  async signup(req, res) {
    const { name, email, password, roleId } = req.body;
    const result = await AuthService.signup(name, email, password, roleId);
    return res.status(result.status).json(result.body);
  },

  async verifyOtp(req, res) {
    const { email, otp } = req.body;
    const result = await AuthService.verifyOtp(email, otp);
    return res.status(result.status).json(result.body);
  },

  async forgotPassword(req, res) {
    const { email } = req.body;
    const result = await AuthService.forgotPassword(email);
    return res.status(result.status).json(result.body);
  },

  async resetPassword(req, res) {
    const { token, password } = req.body;
    const result = await AuthService.resetPassword(token, password);
    return res.status(result.status).json(result.body);
  },

  async refreshToken(req, res) {
    const { refreshToken } = req.body;
    const result = await AuthService.refreshToken(refreshToken);
    return res.status(result.status).json(result.body);
  },

  async logout(req, res) {
    const { refreshToken, activitySessionId } = req.body;
    const result = await AuthService.logout(refreshToken, activitySessionId);
    return res.status(result.status).json(result.body);
  },
  async heartbeat(req, res) {
    await ActivityService.heartbeat(req.user.id, req.body.activitySessionId, Boolean(req.body.close));
    return res.status(204).end();
  },
};
