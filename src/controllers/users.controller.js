
import { UsersService } from "../services/users.service.js";

export const UsersController = {
  async list(req, res) {
    const users = await UsersService.list();
    return res.json(users);
  },

  async get(req, res) {
    const user = await UsersService.get(Number(req.params.id));
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    return res.json(user);
  },

  async create(req, res) {
    const result = await UsersService.create(req.body);
    return res.status(result.status).json(result.body);
  },

  async update(req, res) {
    const result = await UsersService.update(Number(req.params.id), req.body);
    return res.status(result.status).json(result.body);
  },

  async remove(req, res) {
    const result = await UsersService.remove(Number(req.params.id));
    return res.status(result.status).json(result.body);
  },
};
