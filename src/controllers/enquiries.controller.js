
import { EnquiriesService } from "../services/enquiries.service.js";

export const EnquiriesController = {
  async list(req, res) {
    const enquiries = await EnquiriesService.list();
    return res.json(enquiries);
  },

  async get(req, res) {
    const enquiry = await EnquiriesService.get(Number(req.params.id));
    if (!enquiry) {
      return res.status(404).json({ message: "Enquiry not found." });
    }
    return res.json(enquiry);
  },

  async create(req, res) {
    const enquiry = await EnquiriesService.create(req.body);
    return res.status(201).json(enquiry);
  },

  async update(req, res) {
    const enquiry = await EnquiriesService.update(Number(req.params.id), req.body);
    return res.json(enquiry);
  },

  async remove(req, res) {
    const result = await EnquiriesService.remove(Number(req.params.id));
    return res.json(result);
  },
};
