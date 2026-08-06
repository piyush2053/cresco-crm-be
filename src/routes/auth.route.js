import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { requiresAuth } from '../middlewares.js';

const router = Router();

router.post('/login', AuthController.login);
router.post('/signup', AuthController.signup);
router.post('/verify-otp', AuthController.verifyOtp);
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);
router.post('/refresh-token', AuthController.refreshToken);
router.post('/logout', AuthController.logout);
router.post('/activity/heartbeat', requiresAuth, AuthController.heartbeat);

export default router;
