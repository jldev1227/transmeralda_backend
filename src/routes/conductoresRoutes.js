// src/routes/conductoresRoutes.js - Rutas actualizadas

const express = require('express');
const router = express.Router();
const conductorController = require('../controllers/conductorController');
const { protect } = require('../middleware/auth');

// ====== RUTAS EXISTENTES (mantenidas) ======
router.post('/', protect, conductorController.uploadDocumentos, conductorController.crearConductor);
router.post('/basico', protect, conductorController.crearConductorBasico);
router.get('/', protect, conductorController.obtenerConductores);
router.get('/estadisticas', protect, conductorController.obtenerEstadisticasEstados);
router.get('/basicos', protect, conductorController.obtenerConductoresBasicos);
router.get('/:id', protect, conductorController.obtenerConductorPorId);
router.put('/:id', protect, conductorController.actualizarConductor);
router.delete('/:id', protect, conductorController.eliminarConductor);
router.post('/asignar-vehiculo', conductorController.asignarConductorAVehiculo);

// ====== NUEVAS RUTAS CON MINISTRAL ======

/**
 * ✅ RUTA CORREGIDA - Usar uploadDocumentos que maneja 'files'
 */
router.post('/crear-con-ia', 
  protect, 
  conductorController.uploadDocumentos, // ✅ Esta configuración maneja 'files'
  conductorController.crearConductorConIA
);

/**
 * ✅ RUTA CORREGIDA - Usar uploadDocumentos que maneja 'files'
 */
router.put('/actualizar-con-ia/:id', 
  protect, 
  conductorController.uploadDocumentos, // ✅ Esta configuración maneja 'files'
  conductorController.actualizarConductorConIA
);

/**
 * ✅ RUTA PARA PRUEBAS SIN ARCHIVOS
 */
router.post('/probar-ministral', 
  protect, 
  conductorController.probarMinistral
);

// ====== RUTAS DE UTILIDAD PARA IA ======
router.get('/ia/categorias-permitidas', protect, (req, res) => {
  const categoriasPermitidas = [
    {
      codigo: 'CEDULA',
      nombre: 'Cédula de Ciudadanía',
      obligatorio: true,
      descripcion: 'Documento de identificación personal',
      camposExtraidos: ['nombre', 'apellido', 'numero_identificacion', 'fecha_nacimiento', 'genero', 'tipo_sangre']
    },
    {
      codigo: 'LICENCIA',
      nombre: 'Licencia de Conducir',
      obligatorio: true,
      descripcion: 'Licencia de conducción vigente',
      camposExtraidos: ['licencia_conduccion', 'fecha_expedicion', 'categorias', 'vigencias']
    },
    {
      codigo: 'CONTRATO',
      nombre: 'Contrato Laboral',
      obligatorio: true,
      descripcion: 'Contrato de trabajo o prestación de servicios',
      camposExtraidos: ['fecha_ingreso', 'telefono', 'email', 'direccion']
    },
    {
      codigo: 'FOTO_PERFIL',
      nombre: 'Foto de Perfil',
      obligatorio: false,
      descripcion: 'Fotografía del conductor',
      camposExtraidos: ['foto_perfil']
    }
  ];

  res.json({
    success: true,
    categorias: categoriasPermitidas,
    obligatorias: categoriasPermitidas.filter(cat => cat.obligatorio).map(cat => cat.codigo),
    opcionales: categoriasPermitidas.filter(cat => !cat.obligatorio).map(cat => cat.codigo),
    procesamiento: 'ministral-ai'
  });
});

router.get('/ia/esquema-conductor', protect, (req, res) => {
  const esquema = {
    camposObligatorios: {
      nombre: {
        tipo: 'string',
        descripcion: 'Nombre(s) del conductor',
        fuente: 'CEDULA'
      },
      apellido: {
        tipo: 'string',
        descripcion: 'Apellido(s) del conductor',
        fuente: 'CEDULA'
      },
      numero_identificacion: {
        tipo: 'string',
        descripcion: 'Número de identificación (solo números)',
        fuente: 'CEDULA'
      },
      fecha_nacimiento: {
        tipo: 'string',
        formato: 'DD/MM/YYYY',
        descripcion: 'Fecha de nacimiento',
        fuente: 'CEDULA'
      },
      genero: {
        tipo: 'string',
        valores: ['M', 'F'],
        descripcion: 'Género del conductor',
        fuente: 'CEDULA'
      }
    },
    camposOpcionales: {
      tipo_sangre: {
        tipo: 'string',
        formato: 'A+, B-, O+, etc.',
        descripcion: 'Tipo de sangre',
        fuente: 'CEDULA'
      },
      telefono: {
        tipo: 'string',
        descripcion: 'Número de teléfono',
        fuente: 'CONTRATO'
      },
      email: {
        tipo: 'string',
        descripcion: 'Correo electrónico',
        fuente: 'CONTRATO'
      }
    },
    procesamiento: 'ministral-ai',
    version: '1.0'
  };

  res.json({
    success: true,
    esquema: esquema
  });
});

module.exports = router;