
import { AuthService } from "../services/auth.service.js";

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
    const { refreshToken } = req.body;
    const result = await AuthService.logout(refreshToken);
    return res.status(result.status).json(result.body);
  },
};
