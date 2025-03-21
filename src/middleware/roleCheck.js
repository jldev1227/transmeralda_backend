exports.checkPermiso = (permiso) => {
    return (req, res, next) => {
      if (!req.usuario) {
        return res.status(401).json({
          success: false,
          message: 'Autenticación requerida'
        });
      }
  
      // Verificar si es admin o tiene el permiso específico
      if (req.usuario.role === 'admin' || req.usuario.permisos[permiso]) {
        return next();
      }
  
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para acceder a este recurso'
      });
    };
  };