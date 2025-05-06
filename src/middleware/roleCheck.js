exports.checkPermiso = (permiso) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Autenticación requerida'
        });
      }
  
      // Verificar si es admin o tiene el permiso específico
      if (req.user.role === 'admin' || req.user.permisos[permiso]) {
        return next();
      }
  
      return res.status(403).json({
        success: false,
        message: 'No tienes permiso para acceder a este recurso'
      });
    };
  };