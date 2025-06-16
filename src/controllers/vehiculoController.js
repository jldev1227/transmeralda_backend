// src/controllers/vehiculoController.js
const { Vehiculo, Conductor, Documento } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const { procesarDocumentos, actualizarDocumentosVehiculo } = require('../queues/vehiculo');
const { redisClient } = require('../config/redisClient');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB límite
});

const uploadDocumentos = upload.array('documentos', 10); // Espera un campo llamado 'documentos'

// Obtener todos los vehículos con filtros de documentos
const getVehiculos = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 5,
      search,
      sort = 'placa',
      order = 'ASC',
      // ====== NUEVOS PARÁMETROS DE FILTROS DE DOCUMENTOS ======
      categoriasDocumentos,
      estadosDocumentos,
      fechaVencimientoDesde,
      fechaVencimientoHasta,
      diasAlerta
    } = req.query;

    console.log('Query completa recibida:', req.query);

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
      const estados = req.query.estado.split(',');
      whereClause.estado = { [Op.in]: estados };
    }

    if (req.query.clase) {
      const clases = req.query.clase.split(',');
      whereClause.clase_vehiculo = { [Op.in]: clases };
    }

    // ====== CONFIGURACIÓN DE INCLUDE PARA DOCUMENTOS ======
    let documentosInclude = {
      model: Documento,
      as: 'documentos',
      required: false, // LEFT JOIN por defecto
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
      // Si hay filtros de documentos, hacer INNER JOIN
      documentosInclude.required = true;
      includeOptions.push(documentosInclude);
    } else {
      // Si no hay filtros de documentos, incluir todos los documentos
      includeOptions.push({
        model: Documento,
        as: 'documentos',
        required: false
      });
    }

    // ====== PAGINACIÓN ======
    const offset = (page - 1) * limit;

    // ====== ORDENAMIENTO ======
    let orderArray = [[sort, sequelizeOrder]];

    // Ordenamientos especiales
    switch (sort) {
      case 'vehiculo':
        orderArray = [['placa', sequelizeOrder], ['marca', sequelizeOrder], ['modelo', sequelizeOrder]];
        break;
      case 'fecha_vencimiento_proxima':
        // Ordenar por la fecha de vencimiento más próxima de todos los documentos
        orderArray = [
          [{ model: Documento, as: 'documentos' }, 'fecha_vigencia', sequelizeOrder]
        ];
        break;
    }

    const { count, rows } = await Vehiculo.findAndCountAll({
      where: whereClause,
      include: includeOptions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: orderArray,
      distinct: true, // Importante para contar correctamente con includes
      subQuery: false // Para mejorar performance con includes complejos
    });

    // ====== POST-PROCESAMIENTO DE DATOS ======
    const vehiculosConEstadoDocumentos = rows.map(vehiculo => {
      const vehiculoData = vehiculo.toJSON();
      
      // Calcular estado de documentos para cada vehículo
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
      count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page),
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
    const documentosConVigencia = ["SOAT", "TECNOMECANICA", "TARJETA_DE_OPERACION", "POLIZA_CONTRACTUAL", "POLIZA_EXTRACONTRACTUAL", "POLIZA_TODO_RIESGO", "CERTIFICADO_GPS"];

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
    const sessionId = await procesarDocumentos(adaptedFiles, categoriasArray, datosVehiculo, socketId);

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

    console.log(id, categorias, fechasVigencia);

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
          return res.status(404).json({
            success: false,
            message: 'Vehículo no encontrado'
          });
        }
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
    const documentosConVigencia = ["SOAT", "TECNOMECANICA", "TARJETA_DE_OPERACION", "POLIZA_CONTRACTUAL", "POLIZA_EXTRACONTRACTUAL", "POLIZA_TODO_RIESGO", "CERTIFICADO_GPS"];

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

    // Iniciar procesamiento asíncrono de actualización de documentos
    const sessionId = await actualizarDocumentosVehiculo(
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
    const [updated] = await Vehiculo.update(req.body, {
      where: { id: req.params.id }
    });

    if (updated === 0) {
      return res.status(404).json({
        success: false,
        message: 'Vehículo no encontrado'
      });
    }

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
  getVehicleDocument
};