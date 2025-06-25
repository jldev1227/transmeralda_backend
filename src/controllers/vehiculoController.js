// src/controllers/vehiculoController.js
const { User, Vehiculo, Conductor, Documento } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const { procesarDocumentos, actualizarDocumentosVehiculo } = require('../queues/vehiculo');
const { redisClient } = require('../config/redisClient');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB límite
});

const uploadDocumentos = upload.array('documentos', 10); // Espera un campo llamado 'documentos'

/**
 * Notifica a todos los clientes conectados
 * @param {string} evento - Nombre del evento a emitir
 * @param {object} datos - Datos a enviar
 */
function notificarGlobal(evento, datos) {
  if (!global.io) {
    logger.error(`No se puede emitir evento global ${evento}: global.io no inicializado`);
    return;
  }

  try {
    global.io.emit(evento, datos);
    logger.debug(`Evento ${evento} emitido globalmente a todos los clientes conectados`);
  } catch (error) {
    logger.error(`Error al emitir evento global ${evento}: ${error.message}`);
  }
}

function notifyUser(userId, event, data) {
  try {
    // Obtener la función notifyUser de la aplicación global
    const notifyFn = global.app?.get("notifyUser");

    if (notifyFn) {
      notifyFn(userId, event, data);
    } else {
      console.log(
        `No se pudo notificar al usuario ${userId} (evento: ${event}) - Socket.IO no está disponible`
      );
    }
  } catch (error) {
    console.error("Error al notificar al usuario:", error);
  }
}
/**
 * Obtener todos los vehículos con filtros de documentos (sin paginación/limit)
 */
const getVehiculos = async (req, res) => {
  try {
    const {
      search,
      sort = 'placa',
      order = 'ASC',
      categoriasDocumentos,
      estadosDocumentos,
      fechaVencimientoDesde,
      fechaVencimientoHasta,
      diasAlerta
    } = req.query;

    const sequelizeOrder = order === 'ascending' ? 'ASC' : 'DESC';
    const whereClause = {};
    const includeOptions = [];

    // ====== PROCESAMIENTO DE BÚSQUEDA GENERAL ======
    if (search) {
      whereClause[Op.or] = [
        { placa: { [Op.iLike]: `%${search}%` } },
        { marca: { [Op.iLike]: `%${search}%` } },
        { modelo: { [Op.iLike]: `%${search}%` } },
        { linea: { [Op.iLike]: `%${search}%` } },
        { propietario_nombre: { [Op.iLike]: `%${search}%` } },
        { propietario_identificacion: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // ====== FILTROS BÁSICOS DE VEHÍCULOS ======
    if (req.query.estado) {
      const estados = req.query.estado.split(',').map(e => e.toUpperCase());
      whereClause.estado = { [Op.in]: estados };
    }

    if (req.query.clase) {
      const clases = req.query.clase.split(',').map(c => c.toUpperCase());
      whereClause.clase_vehiculo = { [Op.in]: clases };
    }

    // ====== CONFIGURACIÓN DE INCLUDE PARA DOCUMENTOS ======
    let documentosInclude = {
      model: Documento,
      as: 'documentos',
      required: false,
      where: {}
    };

    let hayFiltrosDocumentos = false;

    // ====== FILTROS POR CATEGORÍAS DE DOCUMENTOS ======
    if (categoriasDocumentos) {
      const categorias = categoriasDocumentos.split(',');
      documentosInclude.where.categoria = { [Op.in]: categorias };
      hayFiltrosDocumentos = true;
      console.log('Filtro por categorías de documentos:', categorias);
    }

    // ====== FILTROS POR ESTADOS DE DOCUMENTOS ======
    if (estadosDocumentos) {
      const estados = estadosDocumentos.split(',');
      const documentosWhere = [];
      const hoy = new Date();

      estados.forEach(estado => {
        switch (estado) {
          case 'VIGENTE':
            documentosWhere.push({
              fecha_vigencia: { [Op.gte]: hoy },
              estado: 'vigente'
            });
            break;
          case 'VENCIDO':
            documentosWhere.push({
              fecha_vigencia: { [Op.lt]: hoy },
              estado: 'vigente'
            });
            break;
          case 'POR_VENCER_30':
            const en30Dias = new Date();
            en30Dias.setDate(hoy.getDate() + 30);
            documentosWhere.push({
              fecha_vigencia: {
                [Op.between]: [hoy, en30Dias]
              },
              estado: 'vigente'
            });
            break;
          case 'POR_VENCER_15':
            const en15Dias = new Date();
            en15Dias.setDate(hoy.getDate() + 15);
            documentosWhere.push({
              fecha_vigencia: {
                [Op.between]: [hoy, en15Dias]
              },
              estado: 'vigente'
            });
            break;
          case 'POR_VENCER_7':
            const en7Dias = new Date();
            en7Dias.setDate(hoy.getDate() + 7);
            documentosWhere.push({
              fecha_vigencia: {
                [Op.between]: [hoy, en7Dias]
              },
              estado: 'vigente'
            });
            break;
          case 'SIN_DOCUMENTO':
            // Este caso requiere lógica especial - vehículos sin ciertos documentos
            break;
        }
      });

      if (documentosWhere.length > 0) {
        documentosInclude.where[Op.or] = documentosWhere;
        hayFiltrosDocumentos = true;
        console.log('Filtro por estados de documentos:', estados);
      }
    }

    // ====== FILTROS POR FECHAS DE VENCIMIENTO ======
    if (fechaVencimientoDesde || fechaVencimientoHasta) {
      const fechaWhere = {};

      if (fechaVencimientoDesde) {
        fechaWhere[Op.gte] = new Date(fechaVencimientoDesde);
      }

      if (fechaVencimientoHasta) {
        fechaWhere[Op.lte] = new Date(fechaVencimientoHasta);
      }

      documentosInclude.where.fecha_vigencia = fechaWhere;
      hayFiltrosDocumentos = true;
      console.log('Filtro por fechas de vencimiento:', { fechaVencimientoDesde, fechaVencimientoHasta });
    }

    // ====== FILTRO POR DÍAS DE ALERTA ======
    if (diasAlerta) {
      const fechaAlerta = new Date();
      fechaAlerta.setDate(fechaAlerta.getDate() + parseInt(diasAlerta));

      documentosInclude.where.fecha_vigencia = {
        [Op.between]: [new Date(), fechaAlerta]
      };
      hayFiltrosDocumentos = true;
      console.log('Filtro por días de alerta:', diasAlerta);
    }

    // ====== CONFIGURAR INCLUDE FINAL ======
    if (hayFiltrosDocumentos) {
      documentosInclude.required = true;
      includeOptions.push(documentosInclude);
    } else {
      includeOptions.push({
        model: Documento,
        as: 'documentos',
        required: false
      });
    }

    // ====== ORDENAMIENTO ======
    let orderArray = [[sort, sequelizeOrder]];

    switch (sort) {
      case 'vehiculo':
        orderArray = [['placa', sequelizeOrder], ['marca', sequelizeOrder], ['modelo', sequelizeOrder]];
        break;
      case 'fecha_vencimiento_proxima':
        orderArray = [
          [{ model: Documento, as: 'documentos' }, 'fecha_vigencia', sequelizeOrder]
        ];
        break;
    }

    // ====== CONSULTA SIN LIMIT ======
    const vehiculos = await Vehiculo.findAll({
      where: whereClause,
      include: includeOptions,
      order: orderArray,
      distinct: true,
      subQuery: false
    });

    // ====== POST-PROCESAMIENTO DE DATOS ======
    const vehiculosConEstadoDocumentos = vehiculos.map(vehiculo => {
      const vehiculoData = vehiculo.toJSON();
      if (vehiculoData.documentos) {
        vehiculoData.estadoDocumentos = calcularEstadoDocumentos(vehiculoData.documentos);
        vehiculoData.documentosVencidos = vehiculoData.documentos.filter(doc =>
          new Date(doc.fecha_vigencia) < new Date()
        ).length;
        vehiculoData.documentosPorVencer = vehiculoData.documentos.filter(doc => {
          const hoy = new Date();
          const vencimiento = new Date(doc.fecha_vigencia);
          const diasRestantes = Math.ceil((vencimiento - hoy) / (1000 * 60 * 60 * 24));
          return diasRestantes <= 30 && diasRestantes > 0;
        }).length;
      }
      return vehiculoData;
    });

    res.status(200).json({
      success: true,
      count: vehiculosConEstadoDocumentos.length,
      data: vehiculosConEstadoDocumentos,
      filtrosAplicados: {
        categoriasDocumentos: categoriasDocumentos ? categoriasDocumentos.split(',') : [],
        estadosDocumentos: estadosDocumentos ? estadosDocumentos.split(',') : [],
        fechaVencimientoDesde,
        fechaVencimientoHasta,
        diasAlerta
      }
    });

  } catch (error) {
    console.error('Error al obtener vehículos:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener vehículos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ====== FUNCIÓN AUXILIAR PARA CALCULAR ESTADO DE DOCUMENTOS ======
const calcularEstadoDocumentos = (documentos) => {
  if (!documentos || documentos.length === 0) {
    return 'SIN_DOCUMENTOS';
  }

  const hoy = new Date();
  let tieneVencidos = false;
  let tienePorVencer = false;

  documentos.forEach(doc => {
    const fechaVencimiento = new Date(doc.fecha_vigencia);
    const diasRestantes = Math.ceil((fechaVencimiento - hoy) / (1000 * 60 * 60 * 24));

    if (diasRestantes < 0) {
      tieneVencidos = true;
    } else if (diasRestantes <= 30) {
      tienePorVencer = true;
    }
  });

  if (tieneVencidos) return 'CON_VENCIDOS';
  if (tienePorVencer) return 'POR_VENCER';
  return 'VIGENTE';
};

// Obtener un vehículo por ID
const getVehiculoById = async (req, res) => {
  try {
    const { id } = req.params;

    const vehiculo = await Vehiculo.findByPk(id, {
      include: [
        { model: Conductor, as: 'conductor' }
      ]
    });

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      vehiculo
    });
  } catch (error) {
    console.error('Error al obtener vehículo por ID:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el vehículo',
      error: error.message
    });
  }
};

// Crear un nuevo vehículo
const createVehiculo = async (req, res) => {
  try {
    // Extraer datos del formulario
    const { categorias, fechasVigencia } = req.body;
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

    // Convertir fechas de vigencia a objeto si llega como string
    let fechasVigenciaObj = {};
    if (fechasVigencia) {
      if (typeof fechasVigencia === 'string') {
        try {
          fechasVigenciaObj = JSON.parse(fechasVigencia);
        } catch (e) {
          console.warn('Error al parsear fechas de vigencia:', e.message);
        }
      } else {
        fechasVigenciaObj = fechasVigencia;
      }
    }

    const categoriasPermitidas = [
      "TARJETA_DE_PROPIEDAD",
      "SOAT",
      "TECNOMECANICA",
      "TARJETA_DE_OPERACION",
      "POLIZA_CONTRACTUAL",
      "POLIZA_EXTRACONTRACTUAL",
      "POLIZA_TODO_RIESGO",
      "CERTIFICADO_GPS"
    ];

    // Definir categorías obligatorias
    const categoriasObligatorias = ["TARJETA_DE_PROPIEDAD"];

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

    // Validar fechas de vigencia para documentos que las requieren
    const documentosConVigencia = ["SOAT", "TECNOMECANICA", "TARJETA_DE_OPERACION", "POLIZA_CONTRACTUAL", "POLIZA_EXTRACONTRACTUAL", "POLIZA_TODO_RIESGO"];

    // Obtener fecha actual solo con día, mes y año (sin horas)
    const fechaActual = new Date();
    fechaActual.setHours(0, 0, 0, 0);

    for (const categoria of categoriasArray) {
      if (documentosConVigencia.includes(categoria)) {
        const fechaVigencia = fechasVigenciaObj[categoria];


        if (!fechaVigencia) {
          return res.status(400).json({
            success: false,
            message: `La fecha de vigencia es requerida para ${categoria}.`
          });
        }

        // Crear objeto Date desde el string de fecha
        const fechaVigenciaDate = new Date(fechaVigencia);

        if (isNaN(fechaVigenciaDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: `Formato de fecha inválido para ${categoria}.`
          });
        }

        // Comparar solo fechas (sin considerar horas)
        fechaVigenciaDate.setHours(0, 0, 0, 0);

        if (fechaVigenciaDate <= fechaActual) {
          return res.status(400).json({
            success: false,
            message: `La fecha de vigencia para ${categoria} debe ser posterior a la fecha actual.`
          });
        }
      }
    }

    // Adaptar los archivos de multer al formato esperado por el procesador
    const adaptedFiles = files.map((file, index) => ({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      categoria: categoriasArray[index]
    }));

    // Preparar datos del vehículo con fechas normalizadas
    const fechasVigenciaNormalizadas = {};
    Object.keys(fechasVigenciaObj).forEach(categoria => {
      const fecha = new Date(fechasVigenciaObj[categoria]);
      // Guardar como ISO string para consistencia
      fechasVigenciaNormalizadas[categoria] = fecha.toISOString().split('T')[0]; // Solo la fecha YYYY-MM-DD
    });

    const datosVehiculo = {
      fechasVigencia: fechasVigenciaNormalizadas
    };

    // Obtener el ID del socket del cliente
    const socketId = req.headers['socket-id'] || req.body.socketId || 'unknown';

    // Iniciar procesamiento asíncrono
    const sessionId = await procesarDocumentos(req.user.id, adaptedFiles, categoriasArray, datosVehiculo, socketId);

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

// Actualizar documentos de un vehículo existente
const updateVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      categorias,
      fechasVigencia,
      placa,
      marca,
      linea,
      modelo,
      color,
      clase_vehiculo,
      kilometraje,
      estado,
      galeria
    } = req.body;
    const files = req.files;

    // Validar que se proporcione el ID del vehículo
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID del vehículo es requerido."
      });
    }

    // Preparar los campos básicos para actualizar
    const camposBasicos = {};
    if (placa !== undefined) camposBasicos.placa = placa;
    if (marca !== undefined) camposBasicos.marca = marca;
    if (linea !== undefined) camposBasicos.linea = linea;
    if (modelo !== undefined) camposBasicos.modelo = modelo;
    if (color !== undefined) camposBasicos.color = color;
    if (clase_vehiculo !== undefined) camposBasicos.clase_vehiculo = clase_vehiculo;
    if (kilometraje !== undefined) camposBasicos.kilometraje = kilometraje;
    if (estado !== undefined) camposBasicos.estado = estado;
    if (galeria !== undefined) camposBasicos.galeria = galeria;

    // Si hay campos básicos para actualizar, actualizarlos primero
    if (Object.keys(camposBasicos).length > 0) {
      try {
        // Aquí deberías llamar a tu función para actualizar los campos básicos del vehículo
        const [updated] = await Vehiculo.update(camposBasicos, { where: { id } });
        if (updated === 0) {
          console.log('Vehículo no encontrado al intentar actualizar campos básicos');
          return res.status(404).json({
            success: false,
            message: 'Vehículo no encontrado'
          });
        }
        console.log('Campos básicos del vehículo actualizados correctamente');
      } catch (error) {
        console.error('Error al actualizar campos básicos:', error);
        return res.status(500).json({
          success: false,
          message: "Error al actualizar los campos básicos del vehículo"
        });
      }
    }

    // Si no hay archivos ni categorías para documentos, devolver respuesta exitosa
    if (!files || !categorias || files.length === 0 || categorias.length === 0) {
      console.log('No se proporcionaron archivos ni categorías para documentos. Actualización solo de campos básicos.');
      return res.status(200).json({
        success: true,
        message: Object.keys(camposBasicos).length > 0
          ? "Vehículo actualizado exitosamente."
          : "No se proporcionaron datos para actualizar."
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

    // Si las categorías están vacías después de procesar
    if (!Array.isArray(categoriasArray) || categoriasArray.length === 0) {
      return res.status(200).json({
        success: true,
        message: Object.keys(camposBasicos).length > 0
          ? "Vehículo actualizado exitosamente."
          : "No se proporcionaron documentos para actualizar."
      });
    }

    // Convertir fechas de vigencia a objeto si llega como string
    let fechasVigenciaObj = {};
    if (fechasVigencia) {
      if (typeof fechasVigencia === 'string') {
        try {
          fechasVigenciaObj = JSON.parse(fechasVigencia);
        } catch (e) {
          console.warn('Error al parsear fechas de vigencia:', e.message);
        }
      } else {
        fechasVigenciaObj = fechasVigencia;
      }
    }

    // Validar fechas de vigencia para documentos que las requieren
    const documentosConVigencia = ["SOAT", "TECNOMECANICA", "TARJETA_DE_OPERACION", "POLIZA_CONTRACTUAL", "POLIZA_EXTRACONTRACTUAL", "POLIZA_TODO_RIESGO"];
    // Obtener fecha actual solo con día, mes y año (sin horas)
    const fechaActual = new Date();
    fechaActual.setHours(0, 0, 0, 0);

    for (const categoria of categoriasArray) {
      if (documentosConVigencia.includes(categoria)) {
        const fechaVigencia = fechasVigenciaObj[categoria];

        if (!fechaVigencia) {
          return res.status(400).json({
            success: false,
            message: `La fecha de vigencia es requerida para ${categoria}.`
          });
        }

        // Crear objeto Date desde el string de fecha
        const fechaVigenciaDate = new Date(fechaVigencia);

        if (isNaN(fechaVigenciaDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: `Formato de fecha inválido para ${categoria}.`
          });
        }

        // Comparar solo fechas (sin considerar horas)
        fechaVigenciaDate.setHours(0, 0, 0, 0);

        if (fechaVigenciaDate <= fechaActual) {
          return res.status(400).json({
            success: false,
            message: `La fecha de vigencia para ${categoria} debe ser posterior a la fecha actual.`
          });
        }
      }
    }

    // Adaptar los archivos de multer al formato esperado por el procesador
    const adaptedFiles = files.map((file, index) => ({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      categoria: categoriasArray[index]
    }));

    // Normalizar fechas de vigencia antes de guardar
    const fechasVigenciaNormalizadas = {};
    Object.keys(fechasVigenciaObj).forEach(categoria => {
      const fecha = new Date(fechasVigenciaObj[categoria]);
      // Guardar como ISO string para consistencia
      fechasVigenciaNormalizadas[categoria] = fecha.toISOString().split('T')[0]; // Solo la fecha YYYY-MM-DD
    });

    // Obtener el ID del socket del cliente
    const socketId = req.headers['socket-id'] || req.body.socketId || 'unknown';

    console.log(req.user.id, categoriasArray, fechasVigenciaNormalizadas, id, socketId);

    // Iniciar procesamiento asíncrono de actualización de documentos
    const sessionId = await actualizarDocumentosVehiculo(
      req.user.id,
      adaptedFiles,
      categoriasArray,
      fechasVigenciaNormalizadas,
      id,
      socketId
    );

    // Devolver respuesta inmediata
    return res.status(202).json({
      success: true,
      sessionId,
      message: "La actualización del vehículo ha comenzado. Recibirás actualizaciones en tiempo real."
    });
  } catch (error) {
    console.error("Error al actualizar el vehículo:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Error interno del servidor"
    });
  }
};

// Crear un nuevo vehículo básico
const createVehiculoBasico = async (req, res) => {
  try {
    // Obtener datos del vehículo del body
    const vehiculoData = req.body;

    // Verificar campos mínimos obligatorios
    const camposObligatorios = ['placa', 'marca', 'modelo', 'clase_vehiculo', 'linea'];
    const camposFaltantes = camposObligatorios.filter(campo => !vehiculoData[campo]);

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Los siguientes campos son obligatorios: ${camposFaltantes.join(', ')}`
      });
    }

    // Convertir campos camelCase a snake_case si es necesario
    const datosNormalizados = {
      placa: vehiculoData.placa,
      marca: vehiculoData.marca,
      modelo: vehiculoData.modelo,
      linea: vehiculoData.linea,
      clase_vehiculo: vehiculoData.clase_vehiculo,
      color: vehiculoData.color || null,
    };

    // Crear vehículo en la base de datos
    const nuevoVehiculo = await Vehiculo.create(datosNormalizados);

    notifyUser(req.user.id, 'vehiculo:creado', {
      vehiculo: nuevoVehiculo,
    });

    const { id, nombre } = await User.findByPk(req.user.id);

    notificarGlobal('vehiculo:creado-global', {
      usuarioId: id,
      usuarioNombre: nombre,
      vehiculo: nuevoVehiculo,
    });

    // Responder con el vehículo creado
    return res.status(201).json({
      success: true,
      message: "Vehículo registrado correctamente",
      data: nuevoVehiculo
    });

  } catch (error) {
    console.error("Error al registrar vehículo:", error);

    // Manejo específico para error de placa duplicada
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: "Ya existe un vehículo con esta placa"
      });
    }

    // Manejo para errores de validación
    if (error.name === 'SequelizeValidationError') {
      const errores = error.errors.map(err => `${err.path}: ${err.message}`);
      return res.status(400).json({
        success: false,
        message: "Error de validación",
        errors: errores
      });
    }

    // Error genérico
    return res.status(500).json({
      success: false,
      message: error.message || "Error interno del servidor"
    });
  }
};

// Actualizar un vehículo existente de manera básica
const updateVehiculoBasico = async (req, res) => {
  try {
    console.log(req.body);
    const [updated] = await Vehiculo.update(req.body, {
      where: { id: req.params.id }
    });

    if (updated === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    // Obtener el vehículo actualizado para retornarlo
    const vehiculoActualizado = await Vehiculo.findByPk(req.params.id);

    notifyUser(req.user.id, 'vehiculo:actualizado', {
      vehiculo: vehiculoActualizado,
    });

    const { id, nombre } = await User.findByPk(req.user.id);

    notificarGlobal('vehiculo:actualizado-global', {
      usuarioId: id,
      usuarioNombre: nombre,
      vehiculo: vehiculoActualizado,
    });

    res.status(200).json({
      success: true,
      message: 'Vehículo actualizado exitosamente',
      data: vehiculoActualizado
    });
  } catch (error) {
    console.error('Error al actualizar vehiculo:', error);
    res.status(500).json({
      success: false,
      message: 'Error al actualizar conductor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Eliminar un vehículo
const deleteVehiculo = async (req, res) => {
  try {
    const { id } = req.params;

    const vehiculo = await Vehiculo.findByPk(id);

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    // Eliminar archivos de galería si existen
    if (vehiculo.galeria && vehiculo.galeria.length > 0) {
      vehiculo.galeria.forEach(filePath => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }

    await vehiculo.destroy();

    return res.status(200).json({
      success: true,
      message: 'Vehículo eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error al eliminar vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar el vehículo',
      error: error.message
    });
  }
};

// Actualizar estado del vehículo
const updateEstadoVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!['DISPONIBLE', 'NO DISPONIBLE', 'MANTENIMIENTO', 'INACTIVO'].includes(estado)) {
      return res.status(400).json({
        success: false,
        message: 'Estado no válido. Use: DISPONIBLE, NO DISPONIBLE, MANTENIMIENTO o INACTIVO'
      });
    }

    const vehiculo = await Vehiculo.findByPk(id);

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    await vehiculo.update({ estado });

    return res.status(200).json({
      success: true,
      message: `Estado del vehículo actualizado a ${estado}`,
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar estado del vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el estado del vehículo',
      error: error.message
    });
  }
};

// Actualizar ubicación del vehículo
const updateUbicacionVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const { latitud, longitud } = req.body;

    if (!latitud || !longitud) {
      return res.status(400).json({
        success: false,
        message: 'Latitud y longitud son requeridas'
      });
    }

    const vehiculo = await Vehiculo.findByPk(id);

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    await vehiculo.update({ latitud, longitud });

    return res.status(200).json({
      success: true,
      message: 'Ubicación del vehículo actualizada',
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar ubicación del vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar la ubicación del vehículo',
      error: error.message
    });
  }
};

// Actualizar kilometraje del vehículo
const updateKilometrajeVehiculo = async (req, res) => {
  try {
    const { id } = req.params;
    const { kilometraje } = req.body;

    if (isNaN(kilometraje) || kilometraje < 0) {
      return res.status(400).json({
        success: false,
        message: 'El kilometraje debe ser un número positivo'
      });
    }

    const vehiculo = await Vehiculo.findByPk(id);

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    await vehiculo.update({ kilometraje });

    return res.status(200).json({
      success: true,
      message: 'Kilometraje del vehículo actualizado',
      vehiculo
    });
  } catch (error) {
    console.error('Error al actualizar kilometraje del vehículo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el kilometraje del vehículo',
      error: error.message
    });
  }
};

// Eliminar imagen de la galería
const deleteGaleriaImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { imagePath } = req.body;

    if (!imagePath) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere la ruta de la imagen a eliminar'
      });
    }

    const vehiculo = await Vehiculo.findByPk(id);

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    // Verificar si la imagen existe en la galería
    const galeriaActual = vehiculo.galeria || [];
    if (!galeriaActual.includes(imagePath)) {
      return res.status(404).json({
        success: false,
        message: 'Imagen no encontrada en la galería'
      });
    }

    // Eliminar archivo físico
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    // Actualizar galería en la base de datos
    const nuevaGaleria = galeriaActual.filter(img => img !== imagePath);
    await vehiculo.update({ galeria: nuevaGaleria });

    return res.status(200).json({
      success: true,
      message: 'Imagen eliminada de la galería',
      vehiculo
    });
  } catch (error) {
    console.error('Error al eliminar imagen de la galería:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al eliminar la imagen',
      error: error.message
    });
  }
};

// Asignar conductor al vehículo
const asignarConductor = async (req, res) => {
  try {
    const { id } = req.params;
    const { conductorId } = req.body;

    if (!conductorId) {
      return res.status(400).json({
        success: false,
        message: 'El ID del conductor es requerido'
      });
    }

    const vehiculo = await Vehiculo.findByPk(id);

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    const conductor = await Usuario.findByPk(conductorId);

    if (!conductor) {
      return res.status(404).json({
        success: false,
        message: 'Conductor no encontrado'
      });
    }

    await vehiculo.update({ conductorId });

    return res.status(200).json({
      success: true,
      message: 'Conductor asignado exitosamente',
      vehiculo
    });
  } catch (error) {
    console.error('Error al asignar vehiculo:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al asignar el conductor',
      error: error.message
    });
  }
};

// Buscar vehículos por placa
const buscarVehiculosPorPlaca = async (req, res) => {
  try {
    const { placa } = req.query;

    if (!placa) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere una placa para la búsqueda'
      });
    }

    const vehiculos = await Vehiculo.findAll({
      where: {
        placa: {
          [Op.iLike]: `%${placa}%`
        }
      },
      include: [
        { model: Usuario, as: 'propietario' },
        { model: Usuario, as: 'conductor' }
      ]
    });

    return res.status(200).json({
      success: true,
      count: vehiculos.length,
      vehiculos
    });
  } catch (error) {
    console.error('Error al buscar vehículos por placa:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al buscar vehículos',
      error: error.message
    });
  }
};

// En el controlador del backend
const getVehiculosBasicos = async (req, res) => {
  try {
    const vehiculos = await Vehiculo.findAll({
      attributes: ['id', 'placa', 'linea', 'modelo'], // Solo selecciona estos campos
      raw: true // Obtiene solo los datos planos, sin instancias de Sequelize
    });

    return res.status(200).json({
      success: true,
      count: vehiculos.length,
      data: vehiculos
    });
  } catch (error) {
    console.error('Error al obtener vehículos básicos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener los vehículos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Controller para obtener progreso
const getProgressProccess = async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('Consultando progreso para sessionId:', sessionId);

    // Obtener información del progreso desde Redis
    const procesados = await redisClient.hget(`vehiculo:${sessionId}`, 'procesados') || '0';
    const total = await redisClient.hget(`vehiculo:${sessionId}`, 'totalDocumentos') || '0';
    const progreso = await redisClient.hget(`vehiculo:${sessionId}`, 'progreso') || '0';
    const estado = await redisClient.hget(`vehiculo:${sessionId}`, 'estado') || 'pendiente';
    const mensaje = await redisClient.hget(`vehiculo:${sessionId}`, 'mensaje') || 'Procesando...';
    const error = await redisClient.hget(`vehiculo:${sessionId}`, 'error');

    const response = {
      sessionId,
      procesados: parseInt(procesados),
      total: parseInt(total),
      progreso: parseInt(progreso),
      estado,
      mensaje,
      error: error || null,
      porcentaje: total > 0 ? Math.round((parseInt(procesados) / parseInt(total)) * 100) : 0
    };

    console.log('Progreso obtenido:', response);
    res.json(response);

  } catch (error) {
    console.error('Error obteniendo progreso:', error);
    res.status(500).json({
      error: 'Error al obtener el progreso',
      details: error.message
    });
  }
};

const getVehiculoBasico = async (req, res) => {
  try {
    const { id } = req.params;

    const vehiculo = await Vehiculo.findByPk(id, {
      attributes: ['id', 'placa', 'linea', 'modelo'], // Solo selecciona estos campos
      raw: true // Obtiene solo los datos planos, sin instancias de Sequelize
    });

    if (!vehiculo) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

    return res.status(200).json({
      success: true,
      vehiculo: vehiculo
    });
  } catch (error) {
    console.error('Error al obtener vehículo básico:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al obtener el vehículo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Función para subir un documento
async function uploadVehicleDocument(vehicleId, documentType, filePath, filename) {
  const client = await sequelize.connectionManager.getConnection();

  try {
    await client.query('BEGIN');
    const manager = new LargeObjectManager({ pg: client });

    // Crear Large Object y obtener su ID
    const oid = await manager.createAndWritableStream(16384, async (writeStream) => {
      return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(writeStream);
        readStream.on('end', resolve);
        readStream.on('error', reject);
      });
    });

    // Guardar referencia en la base de datos
    await sequelize.models.Document.create({
      vehicleId,
      documentType,
      fileOid: oid,
      filename,
      mimetype: getFileMimeType(filename),
      uploadDate: new Date(),
      metadata: {}
    });

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Función para recuperar un documento
async function getVehicleDocument(documentId) {
  const document = await sequelize.models.Document.findByPk(documentId);
  if (!document) return null;

  const client = await sequelize.connectionManager.getConnection();

  try {
    await client.query('BEGIN');
    const manager = new LargeObjectManager({ pg: client });

    // Leer contenido desde Large Object
    const buffer = await manager.openAndReadableStream(document.fileOid, 16384, async (readStream) => {
      return new Promise((resolve, reject) => {
        const chunks = [];
        readStream.on('data', chunk => chunks.push(chunk));
        readStream.on('end', () => resolve(Buffer.concat(chunks)));
        readStream.on('error', reject);
      });
    });

    await client.query('COMMIT');

    return {
      document,
      buffer
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getReportVigenciasCompressed(req, res) {
  try {
    const { vehiculoIds } = req.body;

    if (!vehiculoIds || !Array.isArray(vehiculoIds) || vehiculoIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere un array de IDs de vehículos'
      });
    }

    // Array para almacenar los buffers de PDFs generados
    const pdfBuffers = [];

    // Generar PDF para cada vehículo
    for (const vehiculoId of vehiculoIds) {
      try {
        // Consultar información del vehículo con Sequelize
        const vehiculo = await Vehiculo.findByPk(vehiculoId, {
          include: [
            {
              model: Documento,
              as: 'documentos', // Ajusta según tu asociación
              order: [['tipo_documento', 'ASC'], ['created_at', 'DESC']]
            }
          ]
        });

        if (!vehiculo) {
          console.log(`Vehículo con ID ${vehiculoId} no encontrado`);
          continue;
        }

        // Obtener documentos (pueden venir del include o consulta separada)
        let documentos = vehiculo.documentos;

        // Si no vienen del include, hacer consulta separada
        if (!documentos) {
          documentos = await Documento.findAll({
            where: {
              vehiculo_id: vehiculoId
            },
            order: [['tipo_documento', 'ASC'], ['created_at', 'DESC']]
          });
        }

        // Generar PDF para este vehículo
        const pdfBuffer = await generateVehiculoPDF(vehiculo, documentos);

        pdfBuffers.push({
          filename: `vehiculo_${vehiculo.placa || vehiculo.id}_reporte.pdf`,
          buffer: pdfBuffer
        });

      } catch (vehiculoError) {
        console.error(`Error procesando vehículo ${vehiculoId}:`, vehiculoError);
        continue;
      }
    }

    if (pdfBuffers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se pudieron generar PDFs para los vehículos solicitados'
      });
    }

    // Comprimir todos los PDFs
    const zipBuffer = await compressPDFs(pdfBuffers);

    // Configurar headers para descarga
    const filename = `reportes_vehiculos_${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', zipBuffer.length);

    // Enviar el archivo comprimido
    res.send(zipBuffer);

  } catch (error) {
    console.error('Error en getReportVigenciasCompressed:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: error.message
    });
  }
}

async function generateVehiculoPDF(vehiculo, documentos) {
  return new Promise((resolve, reject) => {
    try {
      // Crear nuevo documento PDF
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 25, bottom: 25, left: 40, right: 40 },
      });

      // Array para almacenar los chunks del PDF
      const chunks = [];

      const imagePath = path.join(
        __dirname,
        "..",
        "..",
        "public",
        "assets",
        "codi.png"
      );

      // Capturar el stream del PDF
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);

      // === HEADER ===
      doc
        .fontSize(13)
        .fillColor("#2E8B57")
        .font("Helvetica-Bold")
        .text("TRANSPORTES Y SERVICIOS ESMERALDA S.A.S ZOMAC", 40, 30, {
          width: 300,
        });

      doc
        .fontSize(10)
        .fillColor("#000000")
        .font("Helvetica")
        .text("NIT: 901528440-3", 40, 65);

      doc.fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('#2E8B57')
        .text('REPORTE DE DOCUMENTACIÓN VEHICULAR', 40, 100);

      // Logo
      const imageX = 420;
      const imageY = 25;
      doc.image(imagePath, imageX, imageY, {
        fit: [175, 100],
        align: "right",
        valign: "top",
      });

      // === INFORMACIÓN DEL VEHÍCULO ===
      let yPos = 135;

      doc.fontSize(13)
        .font('Helvetica-Bold')
        .fillColor('#2c3e50')
        .text('INFORMACIÓN DEL VEHÍCULO', 40, yPos);

      yPos += 20;
      doc.strokeColor('#2E8B57')
        .lineWidth(2)
        .moveTo(40, yPos)
        .lineTo(555, yPos)
        .stroke();

      yPos += 25;

      // Datos del vehículo en grid 2x3 con más espacio
      const formatDate = (date) => {
        if (!date) return 'No especificado';
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'No especificado';
        // Sumar un día
        d.setDate(d.getDate() + 1);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
      };

      const vehiculoData = [
        { label: 'Placa', value: vehiculo.placa || 'No especificada' },
        { label: 'Marca', value: vehiculo.marca || 'No especificada' },
        { label: 'Modelo', value: vehiculo.modelo || 'No especificado' },
        { label: 'Línea', value: vehiculo.linea || 'No especificado' },
        { label: 'Color', value: vehiculo.color || 'No especificado' },
        { label: 'Fecha Matrícula', value: formatDate(vehiculo.fecha_matricula) },
      ];

      const colWidth = 240;
      const rowHeight = 45;

      for (let i = 0; i < vehiculoData.length; i++) {
        const isLeftColumn = i % 2 === 0;
        const row = Math.floor(i / 2);
        const x = isLeftColumn ? 45 : 45 + colWidth + 25;
        const y = yPos + (row * rowHeight);

        // Fondo sutil alternado por filas
        if (row % 2 === 0) {
          doc.rect(x - 5, y - 5, colWidth + 10, rowHeight)
            .fillColor('#f8f9fa')
            .fill();
        }

        // Label
        doc.fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#7f8c8d')
          .text(vehiculoData[i].label.toUpperCase(), x, y + 4);

        // Value con mayor tamaño
        doc.fontSize(13)
          .font('Helvetica')
          .fillColor('#2c3e50')
          .text(vehiculoData[i].value, x, y + 20, { width: colWidth - 10 });
      }

      yPos += (Math.ceil(vehiculoData.length / 2) * rowHeight) + 35;

      // === DOCUMENTOS ===
      doc.fontSize(13)
        .font('Helvetica-Bold')
        .fillColor('#2c3e50')
        .text('ESTADO DE DOCUMENTOS', 40, yPos);

      yPos += 20;
      doc.strokeColor('#2E8B57')
        .lineWidth(2)
        .moveTo(40, yPos)
        .lineTo(555, yPos)
        .stroke();

      yPos += 25;


      // Headers de tabla más grandes
      const tableHeaders = ['DOCUMENTO', 'FECHA VIGENCIA', 'ESTADO', 'DÍAS RESTANTES POR VENCER'];
      const colWidths = [180, 120, 100, 205];
      const colPositions = [40, 190, 300, 360];

      // Header con mejor diseño
      doc.rect(40, yPos, 515, 25)
        .fillColor('#ecf0f1')
        .fill();

      doc.strokeColor('#bdc3c7')
        .lineWidth(1)
        .rect(40, yPos, 515, 25)
        .stroke();

      doc.fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('#2c3e50');

      tableHeaders.forEach((header, i) => {
        doc.text(header, colPositions[i] + 8, yPos + 8, { width: colWidths[i] - 15 });
      });

      yPos += 30;

      // Mapear documentos por categoría para fácil acceso
      const documentosMap = {};
      if (documentos && documentos.length > 0) {
        documentos.forEach(doc => {
          const cat = (doc.categoria || '').toUpperCase();
          if (!documentosMap[cat]) {
            documentosMap[cat] = doc;
          }
        });
      }

      // Ordenar categorías requeridas según prioridad visual
      const categoriasOrdenadas = [
        "TARJETA_DE_PROPIEDAD",
        "SOAT",
        "TECNOMECANICA",
        "TARJETA_DE_OPERACION",
        "POLIZA_CONTRACTUAL",
        "POLIZA_EXTRACONTRACTUAL",
        "POLIZA_TODO_RIESGO",
        "CERTIFICADO_GPS"
      ];

      // Mostrar todos, pero marcar faltantes los que no estén en documentosMap
      const categoriasParaMostrar = categoriasOrdenadas;

      // Determinar si hay faltantes
      const faltantes = categoriasParaMostrar.filter(cat => !documentosMap[cat] && !(cat === "TECNOMECANICA" && (() => {
        // Lógica especial: tecnomecánica puede no ser requerida aún
        const fechaMatricula = vehiculo.fecha_matricula ? new Date(vehiculo.fecha_matricula) : null;
        if (!fechaMatricula || isNaN(fechaMatricula.getTime())) return false;
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const fechaRequerida = new Date(fechaMatricula);
        fechaRequerida.setFullYear(fechaRequerida.getFullYear() + 2);
        fechaRequerida.setHours(0, 0, 0, 0);
        return hoy < fechaRequerida;
      })()));

      categoriasParaMostrar.forEach((categoria, index) => {
        const rowHeight = 35;
        // Fondo alternado
        if (index % 2 === 0) {
          doc.rect(40, yPos, 515, rowHeight)
            .fillColor('#fafafa')
            .fill();
        }
        // Borde de la fila
        doc.strokeColor('#e8e8e8')
          .lineWidth(0.5)
          .rect(40, yPos, 515, rowHeight)
          .stroke();

        let documento = documentosMap[categoria];
        let estado = 'Faltante';
        let fechaVigencia = 'No especificada';
        let diasRestantes = 'N/A';
        let colorEstado = '#e74c3c';

        // Lógica especial para TECNOMECANICA
        if (categoria === 'TECNOMECANICA') {
          const fechaMatricula = vehiculo.fecha_matricula ? new Date(vehiculo.fecha_matricula) : null;
          const hoy = new Date();
          hoy.setHours(0, 0, 0, 0);

          if (fechaMatricula && !isNaN(fechaMatricula.getTime())) {
            // Fecha en que se requiere tecnomecánica (2 años después de matrícula)
            const fechaRequerida = new Date(fechaMatricula);
            fechaRequerida.setFullYear(fechaRequerida.getFullYear() + 2);
            fechaRequerida.setHours(0, 0, 0, 0);

            // Un mes antes de la fecha requerida
            const fechaAlerta = new Date(fechaRequerida);
            fechaAlerta.setMonth(fechaAlerta.getMonth() - 1);

          if (hoy < fechaAlerta) {
            // Aún no se requiere tecnomecánica
            estado = 'Vigente';
            // Sumar un día solo en este caso
            const fechaRequeridaMostrar = new Date(fechaRequerida);
            fechaRequeridaMostrar.setDate(fechaRequeridaMostrar.getDate() + 1);
            fechaVigencia = `Desde el ${fechaRequeridaMostrar.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
            diasRestantes = `${Math.ceil((fechaRequerida - hoy) / (1000 * 60 * 60 * 24)) + 1} días para requerirse`;
            colorEstado = '#3498db';
          } else if (hoy >= fechaAlerta && hoy < fechaRequerida) {
            // Próxima a requerirse
            estado = 'Próxima a requerir';
            // Sumar un día solo en este caso
            const fechaRequeridaMostrar = new Date(fechaRequerida);
            fechaRequeridaMostrar.setDate(fechaRequeridaMostrar.getDate() + 1);
            fechaVigencia = `Desde el ${fechaRequeridaMostrar.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
            diasRestantes = `${Math.ceil((fechaRequerida - hoy) / (1000 * 60 * 60 * 24)) + 1} días para requerirse`;
            colorEstado = '#f39c12';
          } else if (hoy >= fechaRequerida && !documento) {
            // Ya se requiere y no hay documento
            estado = 'Faltante';
            // Sumar un día a la fecha requerida
            const fechaRequeridaMostrar = new Date(fechaRequerida);
            fechaRequeridaMostrar.setDate(fechaRequeridaMostrar.getDate() + 1);
            fechaVigencia = `Desde el ${fechaRequeridaMostrar.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
            diasRestantes = 'N/A';
            colorEstado = '#e74c3c';
          }
          // Si hay documento, aplicar lógica normal
          if (documento) {
            const fechaVigenciaRaw = documento.fecha_vigencia || documento.fechaVigencia;
            if (fechaVigenciaRaw) {
              const fechaVigenciaDate = new Date(fechaVigenciaRaw);
              fechaVigenciaDate.setHours(0, 0, 0, 0);
              const diffDias = Math.ceil((fechaVigenciaDate - hoy) / (1000 * 60 * 60 * 24));
              fechaVigencia = fechaVigenciaDate.toLocaleDateString('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              });

              if (diffDias < 0) {
                estado = 'Vencido';
                diasRestantes = `${Math.abs(diffDias)} días vencido`;
                colorEstado = '#e74c3c';
              } else if (diffDias === 0) {
                estado = 'Vence hoy';
                diasRestantes = `0 días restantes`;
                colorEstado = '#e74c3c';
              } else if (diffDias <= 30) {
                estado = 'Por vencer';
                diasRestantes = `${diffDias} días restantes`;
                colorEstado = '#f39c12';
              } else {
                estado = 'Vigente';
                diasRestantes = `${diffDias} días restantes`;
                colorEstado = '#27ae60';
              }
            } else {
              estado = 'Sin vigencia';
              fechaVigencia = 'No especificada';
              diasRestantes = 'N/A';
              colorEstado = '#95a5a6';
            }
          }
          } else {
            // No hay fecha de matrícula
            estado = 'Faltante';
            fechaVigencia = 'No hay fecha de matrícula';
            diasRestantes = 'N/A';
            colorEstado = '#95a5a6';
          }
        } else if (documento) {
          if (categoria === 'TARJETA_DE_PROPIEDAD') {
            estado = 'N/A';
            fechaVigencia = 'No aplica';
            diasRestantes = 'N/A';
            colorEstado = '#3498db';
          } else {
            const fechaVigenciaRaw = documento.fecha_vigencia || documento.fechaVigencia;
            if (fechaVigenciaRaw) {
              const hoy = new Date();
              hoy.setHours(0, 0, 0, 0);
              const fechaVigenciaDate = new Date(fechaVigenciaRaw);
              fechaVigenciaDate.setHours(0, 0, 0, 0);
              const diffDias = Math.ceil((fechaVigenciaDate - hoy) / (1000 * 60 * 60 * 24));

              fechaVigencia = fechaVigenciaDate.toLocaleDateString('es-CO', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              });

              if (diffDias <= 0) {
                estado = 'Vencido';
                diasRestantes = `${Math.abs(diffDias)} días vencido`;
                colorEstado = '#e74c3c';
              } else if (diffDias <= 30) {
                estado = 'Por vencer';
                diasRestantes = `${diffDias} días restantes`;
                colorEstado = '#f39c12';
              } else {
                estado = 'Vigente';
                diasRestantes = `${diffDias} días restantes`;
                colorEstado = '#27ae60';
              }
            } else {
              estado = 'Sin vigencia';
              fechaVigencia = 'No especificada';
              diasRestantes = 'N/A';
              colorEstado = '#95a5a6';
            }
          }
        }
        // Si no hay documento, mantener estado "Faltante" y color rojo

        // Barra de color lateral
        doc.rect(40, yPos, 6, rowHeight)
          .fillColor(colorEstado)
          .fill();

        // Contenido de la fila
        doc.fontSize(10)
          .font('Helvetica')
          .fillColor('#2c3e50');

        // Documento
        const nombreDoc = categoria.replace(/_/g, ' ');
        doc.text(nombreDoc, colPositions[0] + 12, yPos + 14, { width: colWidths[0] - 20 });

        // Vigencia
        doc.text(fechaVigencia, colPositions[1] + 8, yPos + 14, {
          width: colWidths[1] - 15,
          align: 'center'
        });

        // Estado con color y negrita
        doc.fillColor(colorEstado)
          .font('Helvetica-Bold')
          .text(estado, colPositions[2] + 8, yPos + 14, { width: colWidths[2] - 15 });

        // Días restantes centrado horizontalmente
        doc.fillColor('#2c3e50')
          .font('Helvetica')
          .text(diasRestantes, colPositions[3] + 8, yPos + 14, {
            width: colWidths[3] - 15,
            align: 'center'
          });

        yPos += rowHeight;
      });

      // Si hay faltantes, mostrar advertencia al final
      if (faltantes.length > 0) {
        yPos += 10;
        doc.fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#e74c3c')
          .text(`Faltan documentos obligatorios: ${faltantes.map(f => f.replace(/_/g, ' ')).join(', ')}`, 45, yPos, {
            width: 500
          });
        yPos += 20;
      }

      // === FOOTER ===
      const footerY = 760;

      doc.strokeColor('#2E8B57')
        .lineWidth(1)
        .moveTo(40, footerY)
        .lineTo(555, footerY)
        .stroke();

      doc.fontSize(9)
        .font('Helvetica')
        .fillColor('#7f8c8d')
        .text('Sistema de Gestión Vehicular - Transportes y Servicios Esmeralda S.A.S', 40, footerY + 10, {
          align: 'center',
          width: 515
        });

      const fechaActual = new Date().toLocaleDateString('es-CO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      doc.fontSize(8)
        .fillColor('#95a5a6')
        .text(`Generado el ${fechaActual}`, 40, footerY + 25, {
          align: 'center',
          width: 515
        });

      // Finalizar el documento
      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

async function compressPDFs(pdfBuffers) {
  return new Promise((resolve, reject) => {
    try {
      // Crear archiver para ZIP
      const archive = archiver('zip', {
        zlib: { level: 9 } // Máxima compresión
      });

      const chunks = [];

      // Capturar los chunks del ZIP
      archive.on('data', chunk => chunks.push(chunk));
      archive.on('end', () => {
        const zipBuffer = Buffer.concat(chunks);
        resolve(zipBuffer);
      });
      archive.on('error', reject);

      // Agregar cada PDF al archivo ZIP
      pdfBuffers.forEach(({ filename, buffer }) => {
        archive.append(buffer, { name: filename });
      });

      // Finalizar el archivo
      archive.finalize();

    } catch (error) {
      reject(error);
    }
  });
}

// Middleware para manejar carga de archivos
const uploadGaleriaImages = upload.array('galeria', 10); // Máximo 10 imágenes

module.exports = {
  getVehiculos,
  getVehiculoById,
  createVehiculo,
  createVehiculoBasico,
  updateVehiculo,
  updateVehiculoBasico,
  deleteVehiculo,
  updateEstadoVehiculo,
  updateUbicacionVehiculo,
  updateKilometrajeVehiculo,
  deleteGaleriaImage,
  asignarConductor,
  buscarVehiculosPorPlaca,
  getVehiculosBasicos,
  getVehiculoBasico,
  uploadGaleriaImages,
  uploadDocumentos,
  getProgressProccess,
  uploadVehicleDocument,
  getVehicleDocument,
  getReportVigenciasCompressed
};