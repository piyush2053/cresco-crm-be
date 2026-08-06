import Layer from"express/lib/router/layer.js";

// Express 4 does not forward rejected async handlers to error middleware.
// Patch the central router layer once so every present and future async API is protected.
const original=Layer.prototype.handle_request;
Layer.prototype.handle_request=function(req,res,next){
  const handler=this.handle;
  if(handler.length>3)return original.call(this,req,res,next);
  try{
    const result=handler(req,res,next);
    if(result&&typeof result.catch==="function")result.catch(next);
  }catch(error){next(error)}
};
