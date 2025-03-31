const { User } = require("../models");
const jwt = require("jsonwebtoken");
const { enviarCorreoVerificacion } = require("../services/emailServices");

// Generar token JWT
const generarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY,
  });
};

// Función para generar un código de verificación de 6 dígitos
const generarCodigoVerificacion = () => {
  // Generar un número aleatorio de 6 dígitos
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Configuración de cookie
const cookieOptions = () => {
  return {
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 horas
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    domain: `.${process.env.DOMAIN}`,
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
  };
};

// Modificación de las funciones login y registro

// Función auxiliar para establecer cookies de usuario
const setUserCookies = (res, usuario, token) => {
  // Información básica del usuario para la cookie (evita incluir datos sensibles)
  const userInfo = {
    id: usuario.id,
    nombre: usuario.nombre,
    correo: usuario.correo,
    role: usuario.role,
    permisos: usuario.permisos
  };

  // Establecer cookie del token
  res.cookie("token", token, cookieOptions());
  
  // Establecer cookie con información del usuario
  res.cookie("userInfo", JSON.stringify(userInfo), {
    ...cookieOptions(),
    // La cookie de userInfo no necesita ser httpOnly ya que debe ser accesible desde JavaScript
    httpOnly: false
  });
};

// Login de usuario (modificado)
exports.login = async (req, res) => {
  try {
    const { correo, password } = req.body;

    // Verificar correo y password
    if (!correo || !password) {
      return res.status(400).json({
        success: false,
        message: "Por favor ingrese correo y contraseña",
      });
    }

    // Buscar usuario por correo
    const usuario = await User.findOne({ where: { correo } });
    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: "Credenciales inválidas",
      });
    }

    // Verificar contraseña
    const isMatch = await usuario.compararPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Credenciales inválidas",
      });
    }

    // Actualizar último acceso
    await usuario.update({ ultimo_acceso: new Date() });

    // Generar token
    const token = generarToken(usuario.id);

    // Establecer cookies
    setUserCookies(res, usuario, token);

    res.status(200).json({
      success: true,
      message: "Inicio de sesión exitoso",
      usuario: usuario.toJSON(),
      token,
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({
      success: false,
      message: "Error al iniciar sesión",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Registrar usuario (modificado)
exports.registro = async (req, res) => {
  try {
    const { nombre, correo, password, telefono, role, permisos } = req.body;

    // Crear usuario usando Sequelize
    const usuario = await User.create({
      nombre,
      correo,
      password, // Se hará hash automáticamente por el hook beforeSave
      telefono,
      role,
      permisos,
    });

    // Generar token
    const token = generarToken(usuario.id);

    // Establecer cookies
    setUserCookies(res, usuario, token);

    res.status(201).json({
      success: true,
      message: "Usuario registrado correctamente",
      usuario: usuario.toJSON(),
      token,
    });
  } catch (error) {
    console.error("Error en registro:", error);

    // Manejo de errores de validación de Sequelize
    if (
      error.name === "SequelizeValidationError" ||
      error.name === "SequelizeUniqueConstraintError"
    ) {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: error.errors.map((e) => ({
          field: e.path,
          message: e.message,
        })),
      });
    }

    res.status(500).json({
      success: false,
      message: "Error al registrar usuario",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Cerrar sesión (modificado para eliminar también la cookie userInfo)
exports.logout = (req, res) => {
  // Eliminar cookie de token
  res.cookie("token", "none", {
    expires: new Date(Date.now() + 10 * 1000), // 10 segundos
    httpOnly: true,
    domain:
      process.env.NODE_ENV === "production"
        ? `.${process.env.DOMAIN}`
        : undefined,
  });

  // Eliminar cookie de información de usuario
  res.cookie("userInfo", "none", {
    expires: new Date(Date.now() + 10 * 1000), // 10 segundos
    httpOnly: false,
    domain:
      process.env.NODE_ENV === "production"
        ? `.${process.env.DOMAIN}`
        : undefined,
  });

  res.status(200).json({
    success: true,
    message: "Sesión cerrada correctamente",
  });
};

// Obtener perfil de usuario
exports.getPerfil = async (req, res) => {
  try {
    // req.usuario ya está establecido por el middleware protect
    res.status(200).json({
      success: true,
      data: req.usuario,
    });
  } catch (error) {
    console.error("Error al obtener perfil:", error);
    res.status(500).json({
      success: false,
      message: "Error al obtener información del usuario",
    });
  }
};

// Actualizar perfil
exports.actualizarPerfil = async (req, res) => {
  try {
    const { nombre, telefono, correo } = req.body;

    // Actualizar usuario
    await req.usuario.update({
      nombre,
      telefono,
      correo
    });

    res.status(200).json({
      success: true,
      message: "Perfil actualizado correctamente",
      data: req.usuario,
    });
  } catch (error) {
    console.error("Error al actualizar perfil:", error);

    // Manejo de errores de validación
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: error.errors.map((e) => ({
          field: e.path,
          message: e.message,
        })),
      });
    }

    res.status(500).json({
      success: false,
      message: "Error al actualizar perfil",
    });
  }
};

// Cambiar contraseña
exports.cambiarPassword = async (req, res) => {
  try {
    const { passwordActual, nuevaPassword } = req.body;

    // Verificar password actual
    const isMatch = await req.usuario.compararPassword(passwordActual);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "La contraseña actual es incorrecta",
      });
    }

    // Actualizar contraseña
    await req.usuario.update({ password: nuevaPassword });

    res.status(200).json({
      success: true,
      message: "Contraseña actualizada correctamente",
    });
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);

    // Manejo de errores de validación
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: error.errors.map((e) => ({
          field: e.path,
          message: e.message,
        })),
      });
    }

    res.status(500).json({
      success: false,
      message: "Error al cambiar contraseña",
    });
  }
};



// Función principal para solicitar cambio de contraseña
exports.solicitarCambioPassword = async (req, res) => {
  try {
    const { correo } = req.body;

    if (!correo) {
      return res.status(400).json({
        success: false,
        message: "Por favor ingrese su correo electrónico",
      });
    }

    // Buscar usuario por correo
    const usuario = await User.findOne({ where: { correo } });
    if (!usuario) {
      // Por seguridad, no revelar si el correo existe o no
      return res.status(200).json({
        success: true,
        message: "Si el correo existe en nuestro sistema, recibirás instrucciones para restablecer tu contraseña",
      });
    }
    const codigoVerificacion = generarCodigoVerificacion();
    
    // Fecha de expiración (15 minutos)
    const fechaExpiracion = new Date(Date.now() + 15 * 60 * 1000);
    
    // Guardar el código en la base de datos
    await usuario.update({
      codigo_recuperacion: codigoVerificacion,
      codigo_expiracion: fechaExpiracion,
    });

    // Enviar correo con el código
    await enviarCorreoVerificacion(correo, codigoVerificacion, usuario.nombre);

    res.status(200).json({
      success: true,
      message: "Se ha enviado un código de verificación a tu correo electrónico",
    });
  } catch (error) {
    console.error("Error al solicitar cambio de contraseña:", error);
    res.status(500).json({
      success: false,
      message: "Error al procesar la solicitud",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Función para verificar el código y permitir el cambio de contraseña
exports.verificarCodigo = async (req, res) => {
  try {
    const { correo, codigo } = req.body;

    if (!correo || !codigo) {
      return res.status(400).json({
        success: false,
        message: "Por favor ingrese correo y código de verificación",
      });
    }

    // Buscar usuario por correo
    const usuario = await User.findOne({ where: { correo } });
    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: "Código o correo inválido",
      });
    }

    // Verificar que exista un código de recuperación
    if (!usuario.codigo_recuperacion) {
      return res.status(401).json({
        success: false,
        message: "No hay solicitud de cambio de contraseña activa",
      });
    }

    // Verificar que el código no haya expirado
    const ahora = new Date();
    if (ahora > usuario.codigo_expiracion) {
      return res.status(401).json({
        success: false,
        message: "El código ha expirado, solicita uno nuevo",
      });
    }

    // Verificar que el código sea correcto
    if (usuario.codigo_recuperacion !== codigo) {
      return res.status(401).json({
        success: false,
        message: "Código incorrecto",
      });
    }

    // Generar un token temporal para cambio de contraseña
    const tokenCambio = crypto.randomBytes(20).toString('hex');
    
    // Guardar el token y su expiración (10 minutos)
    await usuario.update({
      token_cambio_password: tokenCambio,
      token_expiracion: new Date(Date.now() + 10 * 60 * 1000),
      codigo_recuperacion: null,  // Eliminar el código una vez verificado
      codigo_expiracion: null,
    });

    res.status(200).json({
      success: true,
      message: "Código verificado correctamente",
      token: tokenCambio,
    });
  } catch (error) {
    console.error("Error al verificar código:", error);
    res.status(500).json({
      success: false,
      message: "Error al verificar el código",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Función para establecer nueva contraseña
exports.establecerNuevaPassword = async (req, res) => {
  try {
    const { correo, token, nuevaPassword } = req.body;

    if (!correo || !token || !nuevaPassword) {
      return res.status(400).json({
        success: false,
        message: "Todos los campos son requeridos",
      });
    }

    // Buscar usuario por correo
    const usuario = await User.findOne({ where: { correo } });
    if (!usuario) {
      return res.status(401).json({
        success: false,
        message: "Token o correo inválido",
      });
    }

    // Verificar que exista un token de cambio
    if (!usuario.token_cambio_password || usuario.token_cambio_password !== token) {
      return res.status(401).json({
        success: false,
        message: "Token inválido o expirado",
      });
    }

    // Verificar que el token no haya expirado
    const ahora = new Date();
    if (ahora > usuario.token_expiracion) {
      return res.status(401).json({
        success: false,
        message: "El token ha expirado, solicita un nuevo código",
      });
    }

    // Actualizar contraseña
    await usuario.update({
      password: nuevaPassword,
      token_cambio_password: null,
      token_expiracion: null,
    });

    res.status(200).json({
      success: true,
      message: "Contraseña actualizada correctamente",
    });
  } catch (error) {
    console.error("Error al establecer nueva contraseña:", error);
    
    // Manejo de errores de validación
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: error.errors.map((e) => ({
          field: e.path,
          message: e.message,
        })),
      });
    }

    res.status(500).json({
      success: false,
      message: "Error al establecer nueva contraseña",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};