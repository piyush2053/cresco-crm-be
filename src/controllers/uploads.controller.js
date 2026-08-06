
import { UploadsService } from "../services/uploads.service.js";

export const UploadsController = {
  async uploadSupplierTemplate(req, res) {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: "File is required." });
    }
    const upload = await UploadsService.processSupplierExcel(file.originalname, file.buffer);
    return res.json(upload);
  },

  async status(req, res) {
    const status = await UploadsService.status();
    return res.json(status);
  },
};
