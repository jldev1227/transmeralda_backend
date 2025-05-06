const jwt = require('jsonwebtoken');
const { User } = require('../models');

exports.protect = async (req, res, next) => {
  let token;

  // Obtener token de cookies o headers
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No tienes autorización para acceder a este recurso'
    });
  }

  try {
    // Verificar token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Buscar usuario
    const usuario = await User.findByPk(decoded.id);
    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: 'El usuario asociado a este token ya no existe'
      });
    }

    // Actualizar último acceso
    await usuario.update({ ultimo_acceso: new Date() });

    // Añadir usuario a la request
    req.user = usuario;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};

/**
 * Middleware para verificar si un usuario tiene rol o permisos de administrador
 * Se debe usar después del middleware protect que establece req.user
 * @param {Object} req - Objeto request de Express
 * @param {Object} res - Objeto response de Express
 * @param {Function} next - Función next de Express
 */
exports.isAdmin = async (req, res, next) => {
  // Verificar que existe req.user (establecido por el middleware protect)
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Usuario no autenticado'
    });
  }

  try {
    // Obtener usuario fresco de la base de datos para asegurar permisos actualizados
    const usuario = await User.findByPk(req.user.id);
    
    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    // Verificar si el usuario es administrador por rol o por permisos
    const isAdminRole = usuario.role === 'admin';
    const isAdminPermiso = usuario.permisos && usuario.permisos.admin === true;
    
    if (isAdminRole || isAdminPermiso) {
      // Actualizar req.user con datos frescos
      req.user = usuario;
      return next();
    }

    // Si no es admin, denegar acceso
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: Se requieren permisos de administrador'
    });
    
  } catch (error) {
    console.error('Error en middleware isAdmin:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al verificar permisos de administrador'
    });
  }
};

/**
 * Middleware para verificar si un usuario tiene un rol específico
 * @param {String|Array} roles - Rol o array de roles permitidos
 * @returns {Function} Middleware de Express
 */
exports.hasRole = (roles) => {
  return async (req, res, next) => {
    // Verificar que existe req.user (establecido por el middleware protect)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado'
      });
    }

    try {
      // Convertir roles a array si es un string
      const rolesArray = Array.isArray(roles) ? roles : [roles];

      // Obtener usuario fresco de la base de datos
      const usuario = await User.findByPk(req.user.id);
      
      if (!usuario) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no encontrado'
        });
      }

      // Verificar si el usuario tiene alguno de los roles permitidos
      if (rolesArray.includes(usuario.role)) {
        // Actualizar req.user con datos frescos
        req.user = usuario;
        return next();
      }

      // Si no tiene el rol requerido, denegar acceso
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: Se requiere uno de estos roles: ${rolesArray.join(', ')}`
      });
      
    } catch (error) {
      console.error('Error en middleware hasRole:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al verificar roles de usuario'
      });
    }
  };
};

/**
 * Middleware para verificar si un usuario tiene un permiso específico
 * @param {String|Array} permisos - Permiso o array de permisos requeridos
 * @returns {Function} Middleware de Express
 */
exports.hasPermiso = (permisos) => {
  return async (req, res, next) => {
    // Verificar que existe req.user (establecido por el middleware protect)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado'
      });
    }

    try {
      // Convertir permisos a array si es un string
      const permisosArray = Array.isArray(permisos) ? permisos : [permisos];

      // Obtener usuario fresco de la base de datos
      const usuario = await User.findByPk(req.user.id);
      
      if (!usuario) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no encontrado'
        });
      }

      // El administrador tiene todos los permisos
      if (usuario.role === 'admin') {
        req.user = usuario;
        return next();
      }

      // Verificar si el usuario tiene alguno de los permisos requeridos
      const tienePermiso = permisosArray.some(permiso => 
        usuario.permisos && usuario.permisos[permiso] === true
      );

      if (tienePermiso) {
        // Actualizar req.user con datos frescos
        req.user = usuario;
        return next();
      }

      // Si no tiene los permisos requeridos, denegar acceso
      return res.status(403).json({
        success: false,
        message: `Acceso denegado: Se requiere uno de estos permisos: ${permisosArray.join(', ')}`
      });
      
    } catch (error) {
      console.error('Error en middleware hasPermiso:', error);
      return res.status(500).json({
        success: false,
        message: 'Error al verificar permisos de usuario'
      });
    }
  };
};