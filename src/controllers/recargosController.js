// src/controllers/recargoController.js
const { RecargoPlanilla, DiaLaboralPlanilla, HistorialRecargoPlanilla, Conductor, Vehiculo, Empresa } = require('../models');
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configuración de multer para archivos
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../uploads/planillas');

    // Crear directorio si no existe
    try {
      await fs.access(uploadPath);
    } catch {
      await fs.mkdir(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Generar nombre único: timestamp-uuid-originalname
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo PDF e imágenes.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB
  }
});

class RecargoController {

  // Crear nuevo recargo
  async crear(req, res) {
    const transaction = await RecargoPlanilla.sequelize.transaction();

    try {
      console.log('📋 Iniciando creación de recargo...');

      // Obtener userId del middleware de autenticación
      const userId = req.user?.id || req.body.user_id || null;

      console.log(userId ? `Usuario autenticado: ${userId}` : 'Usuario no autenticado');

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      // Determinar si es FormData o JSON
      let data;
      let archivoInfo = null;

      console.log(req.file ? '📎 Recibido FormData con archivo' : '📝 Recibido JSON sin archivo');

      if (req.file) {
        // Es FormData con archivo
        console.log('📎 Procesando FormData con archivo...');

        data = JSON.parse(req.body.recargo_data);

        // Información del archivo adjunto
        archivoInfo = {
          archivo_planilla_url: `/uploads/planillas/${req.file.filename}`,
          archivo_planilla_nombre: req.file.originalname,
          archivo_planilla_tipo: req.file.mimetype,
          archivo_planilla_tamaño: req.file.size
        };

        console.log('📎 Archivo guardado:', req.file.filename);

      } else {
        // Es JSON normal
        console.log('📝 Procesando datos JSON...');
        data = req.body;
      }

      console.log("[async] Datos recibidos:", data);

      // Validar datos requeridos
      const validacionError = this.validarDatos(data);
      if (validacionError) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: validacionError
        });
      }

      // Verificar que existan las entidades relacionadas
      const verificacionError = await this.verificarEntidades(data, transaction);
      if (verificacionError) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: verificacionError
        });
      }

      // Verificar duplicados
      const duplicadoError = await this.verificarDuplicados(data, transaction);
      if (duplicadoError) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: duplicadoError
        });
      }

      // Procesar días laborales
      const diasProcesados = this.procesarDiasLaborales(data.dias_laborales);

      // Calcular totales
      const totales = this.calcularTotales(diasProcesados);

      console.log('🧮 Totales calculados:', totales);

      // Preparar datos del recargo
      const datosRecargo = {
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        empresa_id: data.empresa_id,
        numero_planilla: data.numero_planilla || null,
        mes: parseInt(data.mes),
        año: parseInt(data.año),
        ...totales,
        ...archivoInfo,
        observaciones: data.observaciones || null,
        estado: 'activo'
      };

      // Crear el recargo principal
      console.log('💾 Creando recargo principal...');
      const recargo = await RecargoPlanilla.create(datosRecargo, {
        user_id: userId,
        transaction
      });

      console.log('✅ Recargo creado con ID:', recargo.id);

      // Crear los días laborales
      console.log('📅 Creando días laborales...');
      const diasCreados = [];

      for (const dia of diasProcesados) {
        const diaCreado = await DiaLaboralPlanilla.create({
          recargo_planilla_id: recargo.id,
          ...dia
        }, {
          user_id: userId,
          transaction
        });
        diasCreados.push(diaCreado);
      }

      console.log(`✅ ${diasCreados.length} días laborales creados`);

      // Crear registro en historial
      console.log('📜 Creando registro de historial...');
      await HistorialRecargoPlanilla.create({
        recargo_planilla_id: recargo.id,
        accion: 'creacion',
        version_nueva: 1,
        datos_nuevos: {
          recargo: recargo.toJSON(),
          dias_laborales: diasCreados.map(d => d.toJSON())
        },
        realizado_por_id: userId,
        ip_usuario: req.ip,
        user_agent: req.get('User-Agent'),
        fecha_accion: new Date()
      }, { transaction });

      // Confirmar transacción
      await transaction.commit();
      console.log('🎉 Recargo registrado exitosamente');

      // Obtener recargo completo para respuesta
      const recargoCompleto = await RecargoPlanilla.findByPk(recargo.id, {
        include: [
          {
            model: DiaLaboralPlanilla,
            as: 'dias_laborales'
          },
          {
            model: Conductor,
            as: 'conductor',
            attributes: ['id', 'nombre', 'apellido', 'numero_identificacion']
          },
          {
            model: Vehiculo,
            as: 'vehiculo',
            attributes: ['id', 'placa', 'marca', 'modelo']
          },
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit']
          }
        ]
      });

      return res.status(201).json({
        success: true,
        message: 'Recargo registrado exitosamente',
        data: {
          recargo: recargoCompleto,
          resumen: {
            total_horas: totales.total_horas_trabajadas,
            total_dias: diasCreados.length,
            archivo_adjunto: !!archivoInfo,
            version: 1
          }
        }
      });

    } catch (error) {
      await transaction.rollback();
      console.error('❌ Error creando recargo:', error);

      // Eliminar archivo si se subió pero falló la creación
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
          console.log('🗑️ Archivo eliminado por error en transacción');
        } catch (unlinkError) {
          console.error('⚠️ Error eliminando archivo:', unlinkError);
        }
      }

      return res.status(500).json({
        success: false,
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Obtener recargos con filtros
  async obtener(req, res) {
    try {
      const {
        conductor_id,
        vehiculo_id,
        empresa_id,
        mes,
        año,
        estado,
        numero_planilla,
        page = 1,
        limit = 10,
        include_deleted = false
      } = req.query;

      const where = {};

      // Aplicar filtros
      if (conductor_id) where.conductor_id = conductor_id;
      if (vehiculo_id) where.vehiculo_id = vehiculo_id;
      if (empresa_id) where.empresa_id = empresa_id;
      if (mes) where.mes = parseInt(mes);
      if (año) where.año = parseInt(año);
      if (estado) where.estado = estado;
      if (numero_planilla) {
        where.numero_planilla = {
          [Op.iLike]: `%${numero_planilla}%`
        };
      }

      const options = {
        where,
        include: [
          {
            model: DiaLaboralPlanilla,
            as: 'dias_laborales'
          },
          {
            model: Conductor,
            as: 'conductor',
            attributes: ['id', 'nombre', 'apellido', 'numero_identificacion']
          },
          {
            model: Vehiculo,
            as: 'vehiculo',
            attributes: ['id', 'placa', 'marca', 'modelo']
          },
          {
            model: Empresa,
            as: 'empresa',
            attributes: ['id', 'nombre', 'nit']
          }
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset: (parseInt(page) - 1) * parseInt(limit),
        paranoid: include_deleted !== 'true'
      };

      const { count, rows } = await RecargoPlanilla.findAndCountAll(options);

      return res.json({
        success: true,
        data: {
          recargos: rows,
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(count / parseInt(limit))
          }
        }
      });

    } catch (error) {
      console.error('❌ Error obteniendo recargos:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo recargos',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Obtener recargo por ID
  async obtenerPorId(req, res) {
    try {
      const { id } = req.params;

      const recargo = await RecargoPlanilla.findByPk(id, {
        include: [
          {
            model: DiaLaboralPlanilla,
            as: 'dias_laborales'
          },
          {
            model: Conductor,
            as: 'conductor'
          },
          {
            model: Vehiculo,
            as: 'vehiculo'
          },
          {
            model: Empresa,
            as: 'empresa'
          },
          {
            model: HistorialRecargoPlanilla,
            as: 'historial',
            limit: 10,
            order: [['fecha_accion', 'DESC']]
          }
        ]
      });

      if (!recargo) {
        return res.status(404).json({
          success: false,
          message: 'Recargo no encontrado'
        });
      }

      return res.json({
        success: true,
        data: recargo
      });

    } catch (error) {
      console.error('❌ Error obteniendo recargo:', error);
      return res.status(500).json({
        success: false,
        message: 'Error obteniendo recargo',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  // Métodos auxiliares de validación
  validarDatos(data) {
    const required = ['conductor_id', 'vehiculo_id', 'empresa_id', 'mes', 'año', 'dias_laborales'];

    for (const field of required) {
      if (!data[field]) {
        return `El campo ${field} es requerido`;
      }
    }

    // Validar mes y año
    const mes = parseInt(data.mes);
    const año = parseInt(data.año);

    if (mes < 1 || mes > 12) {
      return 'El mes debe estar entre 1 y 12';
    }

    if (año < 2000 || año > 2100) {
      return 'El año debe estar entre 2000 y 2100';
    }

    // Validar días laborales
    if (!Array.isArray(data.dias_laborales) || data.dias_laborales.length === 0) {
      return 'Debe incluir al menos un día laboral';
    }

    for (const dia of data.dias_laborales) {
      if (!dia.dia || !dia.horaInicio || !dia.horaFin) {
        return 'Todos los días laborales deben tener día, hora de inicio y hora de fin';
      }

      const horaInicio = parseFloat(dia.horaInicio);
      const horaFin = parseFloat(dia.horaFin);

      if (horaInicio >= horaFin) {
        return `Día ${dia.dia}: La hora de fin debe ser mayor que la hora de inicio`;
      }

      if (horaInicio < 0 || horaInicio > 24 || horaFin < 0 || horaFin > 24) {
        return `Día ${dia.dia}: Las horas deben estar entre 0 y 24`;
      }
    }

    return null; // Sin errores
  }

  async verificarEntidades(data, transaction) {
    try {
      // Verificar conductor
      const conductor = await Conductor.findByPk(data.conductor_id, { transaction });
      if (!conductor) {
        return 'Conductor no encontrado';
      }

      // Verificar vehículo
      const vehiculo = await Vehiculo.findByPk(data.vehiculo_id, { transaction });
      if (!vehiculo) {
        return 'Vehículo no encontrado';
      }

      // Verificar empresa
      const empresa = await Empresa.findByPk(data.empresa_id, { transaction });
      if (!empresa) {
        return 'Empresa no encontrada';
      }

      return null; // Sin errores
    } catch (error) {
      return `Error verificando entidades: ${error.message}`;
    }
  }

  async verificarDuplicados(data, transaction) {
    try {
      const existente = await RecargoPlanilla.findOne({
        where: {
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          empresa_id: data.empresa_id,
          mes: parseInt(data.mes),
          año: parseInt(data.año)
        },
        transaction
      });

      if (existente) {
        return `Ya existe un recargo para este conductor, vehículo, empresa y período (${data.mes}/${data.año})`;
      }

      return null; // Sin errores
    } catch (error) {
      return `Error verificando duplicados: ${error.message}`;
    }
  }

  procesarDiasLaborales(diasLaborales) {
    return diasLaborales.map(dia => {
      const horaInicio = parseFloat(dia.horaInicio);
      const horaFin = parseFloat(dia.horaFin);
      const totalHoras = horaFin - horaInicio;

      return {
        dia: parseInt(dia.dia),
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        total_horas: totalHoras,
        hed: parseFloat(dia.hed || 0),
        hen: parseFloat(dia.hen || 0),
        hefd: parseFloat(dia.hefd || 0),
        hefn: parseFloat(dia.hefn || 0),
        rn: parseFloat(dia.rn || 0),
        rd: parseFloat(dia.rd || 0),
        es_festivo: Boolean(dia.es_festivo),
        es_domingo: Boolean(dia.es_domingo),
        observaciones: dia.observaciones || null
      };
    });
  }

  calcularTotales(diasLaborales) {
    return diasLaborales.reduce((acc, dia) => {
      acc.total_horas_trabajadas += dia.total_horas;
      acc.total_hed += dia.hed;
      acc.total_hen += dia.hen;
      acc.total_hefd += dia.hefd;
      acc.total_hefn += dia.hefn;
      acc.total_rn += dia.rn;
      acc.total_rd += dia.rd;
      return acc;
    }, {
      total_horas_trabajadas: 0,
      total_hed: 0,
      total_hen: 0,
      total_hefd: 0,
      total_hefn: 0,
      total_rn: 0,
      total_rd: 0
    });
  }
}

module.exports = {
  RecargoController,
  uploadMiddleware: upload.single('planilla') // Middleware para subir archivos
};