const { Conductor, Vehiculo, Documento, User } = require('../models');
const { Op, ValidationError } = require('sequelize');
const multer = require('multer');
const { procesarDocumentos } = require('../queues/conductor');

exports.uploadDocumentos = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB por archivo
    files: 10 // máximo 10 archivos
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
    }
  }
}).array('files', 10); // ✅ IMPORTANTE: Usar 'files' y permitir hasta 10 archivos

exports.crearConductorBasico = async (req, res) => {
  try {
    const datos = req.body;

    // Determinar si es un conductor de planta basado en los campos presentes
    const esPlanta = !!(
      datos.salario_base &&
      datos.fecha_ingreso &&
      datos.email
    );

    // Validar campos obligatorios para todos los conductores
    const camposBasicosRequeridos = [
      'nombre',
      'apellido',
      'tipo_identificacion',
      'numero_identificacion',
      'telefono'
    ];

    // Validar campos obligatorios para conductores de planta
    const camposPlantaRequeridos = [
      'email',
      'fecha_ingreso'
    ];

    // Recopilar errores de validación
    const errores = [];

    // Verificar campos básicos requeridos
    camposBasicosRequeridos.forEach(campo => {
      if (!datos[campo]) {
        errores.push({
          campo,
          mensaje: `El campo ${campo} es obligatorio`
        });
      }
    });

    // Verificar campos de planta si es conductor de planta
    if (esPlanta) {
      camposPlantaRequeridos.forEach(campo => {
        if (!datos[campo]) {
          errores.push({
            campo,
            mensaje: `El campo ${campo} es obligatorio para conductores de planta`
          });
        }
      });

      // Validaciones adicionales para campos específicos
      if (datos.email && !/^\S+@\S+\.\S+$/.test(datos.email)) {
        errores.push({
          campo: 'email',
          mensaje: 'El formato del correo electrónico no es válido'
        });
      }

      if (datos.password && datos.password.length < 8) {
        errores.push({
          campo: 'password',
          mensaje: 'La contraseña debe tener al menos 8 caracteres'
        });
      }

      if (datos.salario_base && isNaN(parseFloat(datos.salario_base))) {
        errores.push({
          campo: 'salario_base',
          mensaje: 'El salario base debe ser un valor numérico'
        });
      }

      if (datos.fecha_ingreso && !/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_ingreso)) {
        errores.push({
          campo: 'fecha_ingreso',
          mensaje: 'La fecha de ingreso debe tener el formato YYYY-MM-DD'
        });
      }
    } else {
      datos.salario_base = datos.salario_base || 0;
      datos.fecha_ingreso = datos.fecha_ingreso || new Date().toISOString().split('T')[0];
      datos.cargo = datos.cargo || 'CONDUCTOR EXTERNO';

      // Asignar tipo de contrato para conductores no de planta
      datos.tipo_contrato = datos.tipo_contrato || 'PRESTACION';
    }

    // Si hay errores de validación, retornar error
    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores
      });
    }

    // Asignar permisos predeterminados según el tipo de conductor
    datos.permisos = datos.permisos || {
      verViajes: true,
      verMantenimientos: esPlanta,
      verDocumentos: true,
      actualizarPerfil: esPlanta
    };

    // Asignar el creador si está disponible en la petición
    if (req.user && req.user.id) {
      datos.creado_por_id = req.user.id;
    }

    // Crear el conductor
    const nuevoConductor = await Conductor.create(datos, {
      user_id: req.user.id // ID del usuario autenticado
    });

    // Emitir evento para todos los clientes conectados
    const emitConductorEvent = req.app.get('emitConductorEvent');

    if (emitConductorEvent) {
      emitConductorEvent('conductor:creado', nuevoConductor);
    }

    // Retornar respuesta exitosa
    res.status(201).json({
      success: true,
      message: `Conductor ${esPlanta ? 'de planta' : 'externo'} creado exitosamente`,
      data: nuevoConductor
    });

  } catch (error) {
    console.error('Error al crear conductor:', error);

    // Manejar errores de validación de Sequelize
    if (error instanceof ValidationError) {
      const erroresValidacion = error.errors.map(err => ({
        campo: err.path,
        mensaje: err.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errores: erroresValidacion
      });
    }

    // Manejar error de clave única (como email o número de identificación duplicado)
    if (error.name === 'SequelizeUniqueConstraintError') {
      const camposDuplicados = error.errors.map(err => ({
        campo: err.path,
        mensaje: `El ${err.path} ya está en uso por otro conductor`
      }));

      return res.status(409).json({
        success: false,
        message: 'Error de duplicidad',
        errores: camposDuplicados
      });
    }

    // Manejar otros errores
    res.status(500).json({
      success: false,
      message: 'Error al crear conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor'
    });
  }
};

// Crear un nuevo vehículo
exports.crearConductor = async (req, res) => {
  try {
    // Extraer datos del formulario
    const { categorias } = req.body;
    const files = req.files;

    // Validar que se proporcionaron archivos y categorías
    if (!files || !categorias || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Archivos y categorías son requeridos."
      });
    }

    // Convertir categorías a array si llega como string
    let categoriasArray = categorias;
    if (typeof categorias === 'string') {
      try {
        categoriasArray = JSON.parse(categorias);
      } catch (e) {
        categoriasArray = categorias.split(',').map(cat => cat.trim());
      }
    }

    const categoriasPermitidas = ['CEDULA', 'LICENCIA', 'CONTRATO', 'FOTO_PERFIL']

    // Definir categorías obligatorias
    const categoriasObligatorias = ['CEDULA', 'LICENCIA', 'CONTRATO']

    // Verificar si todas las categorías proporcionadas son permitidas
    const categoriasInvalidas = categoriasArray.filter(
      (categoria) => !categoriasPermitidas.includes(categoria)
    );

    if (categoriasInvalidas.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Las siguientes categorías no son válidas: ${categoriasInvalidas.join(", ")}.`
      });
    }

    // Verificar que todas las categorías obligatorias estén presentes
    const categoriasFaltantes = categoriasObligatorias.filter(
      (categoria) => !categoriasArray.includes(categoria)
    );

    if (categoriasFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Falta la tarjeta de propiedad, que es obligatoria.`
      });
    }

    // Adaptar los archivos de multer al formato esperado por el procesador
    const adaptedFiles = files.map((file, index) => ({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      categoria: categoriasArray[index]
    }));

    // Obtener el ID del socket del cliente
    const socketId = req.headers['socket-id'] || req.body.socketId || 'unknown';

    // // Iniciar procesamiento asíncrono
    const sessionId = await procesarDocumentos(req.user.id, adaptedFiles, categoriasArray, socketId);

    // Devolver respuesta inmediata
    return res.status(202).json({
      success: true,
      sessionId,
      message: "El procesamiento de documentos ha comenzado. Recibirás actualizaciones en tiempo real."
    });
  } catch (error) {
    console.error("Error al procesar la solicitud:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error interno del servidor"
    });
  }
};

exports.obtenerConductores = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      sort = 'createdAt',
      order = 'DESC'
    } = req.query;

    const sequelizeOrder = order;

    const whereClause = {};

    // Procesamiento de búsqueda general (busca en varios campos)
    if (search) {
      whereClause[Op.or] = [
        { nombre: { [Op.iLike]: `%${search}%` } },
        { apellido: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { numero_identificacion: { [Op.iLike]: `%${search}%` } },
        { telefono: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Procesamiento de filtro por estado (puede ser múltiple)
    if (req.query.estado) {
      const estados = req.query.estado.split(',');
      whereClause.estado = { [Op.in]: estados };
    }

    // Procesamiento de filtro por sede de trabajo (puede ser múltiple)
    if (req.query.sede_trabajo) {
      const sedes = req.query.sede_trabajo.split(',');
      whereClause.sede_trabajo = { [Op.in]: sedes };
    }

    // Procesamiento de filtro por tipo de identificación (puede ser múltiple)
    if (req.query.tipo_identificacion) {
      const tiposId = req.query.tipo_identificacion.split(',');
      whereClause.tipo_identificacion = { [Op.in]: tiposId };
    }

    // Procesamiento de filtro por tipo de contrato (puede ser múltiple)
    if (req.query.tipo_contrato) {
      const tiposContrato = req.query.tipo_contrato.split(',');
      whereClause.tipo_contrato = { [Op.in]: tiposContrato };
    }

    // Si había filtros simples, intégralos también
    if (req.query.nombre) whereClause.nombre = { [Op.iLike]: `%${req.query.nombre}%` };
    if (req.query.cargo) whereClause.cargo = req.query.cargo;

    const offset = (page - 1) * limit;

    // Determinación del ordenamiento
    let orderArray = [[sort, sequelizeOrder]];

    // Si el ordenamiento es por nombre completo (para mostrar nombre + apellido)
    if (sort === 'conductor') {
      orderArray = [['nombre', sequelizeOrder], ['apellido', sequelizeOrder]];
    }

    const { count, rows } = await Conductor.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: orderArray,
      include: [
        { model: Vehiculo, as: 'vehiculos', attributes: ['id', 'placa'] },
        { model: Documento, as: 'documentos' },
        {
          model: User,
          as: 'creadoPor',
          attributes: ['id', 'nombre', 'correo'],
          required: false // LEFT JOIN - no excluir conductores sin creador
        },
        {
          model: User,
          as: 'actualizadoPor',
          attributes: ['id', 'nombre', 'correo'],
          required: false // LEFT JOIN - no excluir conductores sin actualizador
        }
      ],
      distinct: true  // Importante para contar correctamente con includes
    });

    res.status(200).json({
      success: true,
      count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
      data: rows
    });
  } catch (error) {
    console.error('Error al obtener conductores:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener conductores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.obtenerConductorPorId = async (req, res) => {
  try {
    const conductor = await Conductor.findByPk(req.params.id, {
      include: [
        { model: Vehiculo, as: 'vehiculos', attributes: ['id', 'placa'] },
        { model: Documento, as: 'documentos' }
      ]
    });

    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      data: conductor
    });
  } catch (error) {
    console.error('Error al obtener conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.actualizarConductor = async (req, res) => {
  try {
    const [updated] = await Conductor.update(req.body, {
      where: { id: req.params.id }
    });

    if (updated === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    const conductorActualizado = await Conductor.findByPk(req.params.id);

    // Emitir evento para todos los clientes conectados
    const emitConductorEvent = req.app.get('emitConductorEvent');
    if (emitConductorEvent) {
      emitConductorEvent('conductor:actualizado', conductorActualizado);
    }

    res.status(200).json({
      success: true,
      message: 'Conductor actualizado exitosamente',
      data: conductorActualizado
    });
  } catch (error) {
    console.error('Error al actualizar conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.eliminarConductor = async (req, res) => {
  try {
    const eliminado = await Conductor.destroy({
      where: { id: req.params.id }
    });

    if (eliminado === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Conductor eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar conductor:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.obtenerConductoresBasicos = async (req, res) => {
  try {
    const conductores = await Conductor.findAll({
      attributes: ['id', 'nombre', 'apellido', "numero_identificacion", "salario_base"]
    });

    res.status(200).json({
      success: true,
      count: conductores.length,
      data: conductores
    });
  } catch (error) {
    console.error('Error al obtener conductores básicos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener conductores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.asignarConductorAVehiculo = async (req, res) => {
  try {
    const { conductorId, vehiculoId } = req.body;

    // Verificar que el conductor existe
    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    // Verificar que el vehículo existe
    const vehiculo = await Vehiculo.findByPk(vehiculoId);
    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    // Actualizar el vehículo con el ID del conductor
    await Vehiculo.update(
      { conductor_id: conductorId },
      { where: { id: vehiculoId } }
    );

    const vehiculoActualizado = await Vehiculo.findByPk(vehiculoId, {
      include: [{ model: Conductor, as: 'conductor' }]
    });

    res.status(200).json({
      success: true,
      message: 'Conductor asignado al vehículo exitosamente',
      data: vehiculoActualizado
    });
  } catch (error) {
    console.error('Error al asignar conductor a vehículo:', error);
    res.status(500).json({
      success: false,
      message: 'Error al asignar conductor a vehículo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Funciones para agregar a src/controllers/conductorController.js

const { procesarDocumentosConMinistral, actualizarDocumentosConMinistral } = require('../queues/conductor');
const { procesarDatosOCRConMinistral } = require('../services/ministralConductor');
const logger = require('../utils/logger');

// Crear conductor usando Ministral-3B
exports.crearConductorConIA = async (req, res) => {
  try {
    // Extraer datos del formulario
    const { categorias } = req.body;
    const files = req.files;

    // Validar que se proporcionaron archivos y categorías
    if (!files || !categorias || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Archivos y categorías son requeridos para el procesamiento con IA."
      });
    }

    // Convertir categorías a array si llega como string
    let categoriasArray = categorias;
    if (typeof categorias === 'string') {
      try {
        categoriasArray = JSON.parse(categorias);
      } catch (e) {
        categoriasArray = categorias.split(',').map(cat => cat.trim());
      }
    }

    const categoriasPermitidas = ['CEDULA', 'LICENCIA', 'CONTRATO', 'FOTO_PERFIL'];
    const categoriasObligatorias = ['CEDULA', 'LICENCIA', 'CONTRATO'];

    // Verificar si todas las categorías proporcionadas son permitidas
    const categoriasInvalidas = categoriasArray.filter(
      (categoria) => !categoriasPermitidas.includes(categoria)
    );

    if (categoriasInvalidas.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Las siguientes categorías no son válidas: ${categoriasInvalidas.join(", ")}.`
      });
    }

    // Verificar que todas las categorías obligatorias estén presentes
    const categoriasFaltantes = categoriasObligatorias.filter(
      (categoria) => !categoriasArray.includes(categoria)
    );

    if (categoriasFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Faltan los siguientes documentos obligatorios: ${categoriasFaltantes.join(", ")}.`
      });
    }

    // Adaptar los archivos de multer al formato esperado por el procesador
    const adaptedFiles = files.map((file, index) => ({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      categoria: categoriasArray[index]
    }));

    // Obtener el ID del socket del cliente
    const socketId = req.headers['socket-id'] || req.body.socketId || 'unknown';

    logger.info(`Iniciando procesamiento con Ministral-IA para usuario ${req.user.id}`, {
      categorias: categoriasArray,
      socketId,
      archivos: adaptedFiles.length
    });

    // Iniciar procesamiento asíncrono con Ministral
    const sessionId = await procesarDocumentosConMinistral(
      req.user.id,
      adaptedFiles,
      categoriasArray,
      socketId
    );

    // Devolver respuesta inmediata
    return res.status(202).json({
      success: true,
      sessionId,
      message: "El procesamiento de documentos con Inteligencia Artificial ha comenzado. Recibirás actualizaciones en tiempo real.",
      procesamiento: "ministral-ai",
      endpoint_confirmacion: `/api/conductores/ia/confirmar-datos/${sessionId}`,
      endpoint_estado: `/api/conductores/ia/estado-procesamiento/${sessionId}`
    });

  } catch (error) {
    logger.error("Error al procesar la solicitud con Ministral-IA:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error interno del servidor"
    });
  }
};

// Actualizar conductor usando Ministral-3B
exports.actualizarConductorConIA = async (req, res) => {
  try {
    const { id: conductorId } = req.params;
    const { categorias, fechasVigencia, camposBasicos } = req.body;
    const files = req.files;

    // Validar que el conductorId existe
    if (!conductorId) {
      return res.status(400).json({
        success: false,
        message: "ID del conductor es requerido."
      });
    }

    // Verificar que el conductor existe
    const { Conductor } = require('../models');
    const conductor = await Conductor.findByPk(conductorId);
    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: "Conductor no encontrado."
      });
    }

    // Si hay archivos, validar categorías
    if (files && files.length > 0) {
      if (!categorias) {
        return res.status(400).json({
          success: false,
          message: "Categorías son requeridas cuando se proporcionan archivos."
        });
      }

      let categoriasArray = categorias;
      if (typeof categorias === 'string') {
        try {
          categoriasArray = JSON.parse(categorias);
        } catch (e) {
          categoriasArray = categorias.split(',').map(cat => cat.trim());
        }
      }

      const categoriasPermitidas = ['CEDULA', 'LICENCIA', 'CONTRATO', 'FOTO_PERFIL'];
      const categoriasInvalidas = categoriasArray.filter(
        (categoria) => !categoriasPermitidas.includes(categoria)
      );

      if (categoriasInvalidas.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Las siguientes categorías no son válidas: ${categoriasInvalidas.join(", ")}.`
        });
      }

      // Adaptar archivos
      const adaptedFiles = files.map((file, index) => ({
        buffer: file.buffer,
        filename: file.originalname,
        mimetype: file.mimetype,
        categoria: categoriasArray[index]
      }));

      const socketId = req.headers['socket-id'] || req.body.socketId || 'unknown';

      logger.info(`Iniciando actualización con Ministral-IA para conductor ${conductorId}`, {
        categorias: categoriasArray,
        socketId,
        archivos: adaptedFiles.length,
        camposBasicos: !!camposBasicos
      });

      console.log(req.user.id,
        req.user.id,
        conductorId,
        adaptedFiles,
        categoriasArray,
        socketId,
        camposBasicos
      )

      // Iniciar procesamiento asíncrono con Ministral
      const sessionId = await actualizarDocumentosConMinistral(
        req.user.id,
        conductorId,
        adaptedFiles,
        categoriasArray,
        socketId,
        camposBasicos
      );

      return res.status(202).json({
        success: true,
        sessionId,
        message: "La actualización con Inteligencia Artificial ha comenzado. Recibirás actualizaciones en tiempo real.",
        procesamiento: "ministral-ai",
        endpoint_confirmacion: `/api/conductores/ia/confirmar-datos/${sessionId}`,
        endpoint_estado: `/api/conductores/ia/estado-procesamiento/${sessionId}`
      });

    } else {
      // Solo actualizar campos básicos sin procesamiento OCR
      if (camposBasicos && Object.keys(camposBasicos).length > 0) {
        await conductor.update(camposBasicos);

        return res.status(200).json({
          success: true,
          message: "Conductor actualizado exitosamente.",
          conductor: conductor,
          procesamiento: "campos-basicos"
        });
      }

      return res.status(400).json({
        success: false,
        message: "No se proporcionaron datos para actualizar."
      });
    }

  } catch (error) {
    logger.error("Error al actualizar conductor con Ministral-IA:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error interno del servidor"
    });
  }
};

// Probar Ministral con datos OCR existentes
exports.probarMinistral = async (req, res) => {
  try {
    const { ocrData, categoria, conductorExistente } = req.body;

    if (!ocrData || !categoria) {
      return res.status(400).json({
        success: false,
        message: "ocrData y categoria son requeridos para la prueba."
      });
    }

    const categoriasValidas = ['CEDULA', 'LICENCIA', 'CONTRATO'];
    if (!categoriasValidas.includes(categoria)) {
      return res.status(400).json({
        success: false,
        message: `Categoría no válida. Debe ser: ${categoriasValidas.join(', ')}`
      });
    }

    logger.info(`Probando Ministral-IA para categoría: ${categoria}`, {
      usuario: req.user.id,
      tieneOcrData: !!ocrData,
      tieneConductorExistente: !!conductorExistente
    });

    const resultado = await procesarDatosOCRConMinistral(ocrData, categoria, conductorExistente);

    return res.status(200).json({
      success: true,
      message: "Datos procesados exitosamente con Ministral-IA",
      input: {
        categoria,
        ocrDataSize: JSON.stringify(ocrData).length,
        tieneConductorExistente: !!conductorExistente
      },
      output: {
        datosEstructurados: resultado,
        camposExtraidos: Object.keys(resultado).length,
        procesamiento: "ministral-ai"
      },
      metadata: {
        timestamp: new Date().toISOString(),
        usuario: req.user.id,
        version: "1.0"
      }
    });

  } catch (error) {
    logger.error("Error en prueba de Ministral-IA:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error interno del servidor",
      error: {
        message: error.message,
        type: error.constructor.name
      },
      procesamiento: "ministral-ai"
    });
  }
};