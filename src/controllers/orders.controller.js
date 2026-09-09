import { OrdersService as service } from "../services/orders.service.js";

const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export const OrdersController = {
  masters: wrap(async (req, res) => res.json(await service.masters())),
  pricingPreview: wrap(async (req, res) => res.json(await service.pricingPreview(req.body))),
  list: wrap(async (req, res) => res.json(await service.list(req.query))),
  operational: wrap(async (req, res) => res.json(await service.operational())),
  get: wrap(async (req, res) => {
    const transaction = await service.get(+req.params.id);
    return transaction ? res.json(transaction) : res.status(404).json({ message: "Transaction not found." });
  }),
  create: wrap(async (req, res) => res.status(201).json(await service.create(req.body, req.user.id))),
  addProduct: wrap(async (req, res) => res.status(201).json(await service.addProduct(+req.params.id, req.body))),
  removeProduct: wrap(async (req, res) => res.json(await service.removeProduct(+req.params.id, +req.params.productId))),
  calculate: wrap(async (req, res) => res.json(await service.calculate(+req.params.id, req.user.id))),
  revision: wrap(async (req, res) => res.status(201).json(await service.revision(+req.params.id, req.body, req.user.id))),
  stage: wrap(async (req, res) => res.json(await service.stage(+req.params.id, req.body, req.user.id))),
  communication: wrap(async (req, res) => res.status(201).json(await service.communicate(+req.params.id, req.body, req.user.id))),
  generate: wrap(async (req, res) => res.json(await service.generate(+req.params.id, req.body.type, req.body, req.user.id))),
  document: wrap(async (req, res) => {
    const document = await service.document(+req.params.documentId);
    if (!document) return res.status(404).json({ message: "Document not found." });
    res.setHeader("Content-Type", document.content_type);
    res.setHeader("Content-Disposition", `attachment; filename="${document.file_name}"`);
    return res.send(document.document_content);
  }),
};
