
import { RolesService } from "../services/roles.service.js";

export const RolesController = {
  async list(req, res) {
    const roles = await RolesService.list();
    return res.json(roles);
  },

  async create(req, res) {
    const role = await RolesService.create(req.body);
    return res.status(201).json(role);
  },

  async update(req, res) {
    const role = await RolesService.update(Number(req.params.id), req.body);
    return res.json(role);
  },

  async remove(req, res) {
    const result = await RolesService.remove(Number(req.params.id));
    return res.json(result);
  },
};
