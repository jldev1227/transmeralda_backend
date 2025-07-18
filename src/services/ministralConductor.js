const ModelClient = require("@azure-rest/ai-inference").default;
const { AzureKeyCredential } = require("@azure/core-auth");

const endpoint = process.env.MINISTRAL_ENDPOINT || "https://ministral.openai.azure.com";
const modelName = process.env.MINISTRAL_MODEL_NAME || "Ministral-3B-2"; // Asegúrate de que este modelo esté disponible en tu cuenta
const API_KEY = process.env.MINISTRAL_API_KEY || "";

// Límites más conservadores
const ESTIMATED_CHARS_PER_TOKEN = 3;

class MinistralConductorService {
  constructor() {
    this.client = new ModelClient(endpoint, new AzureKeyCredential(API_KEY));
  }

  /**
   * Estimar tokens aproximados (método simple)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
  }

  /**
   * Truncar texto de manera inteligente
   */
  smartTruncate(text, maxChars) {
    if (text.length <= maxChars) return text;

    const truncated = text.substring(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');

    return lastNewline > maxChars * 0.8 ?
      truncated.substring(0, lastNewline) :
      truncated;
  }

  /**
   * Truncar datos OCR de manera agresiva
   */
  _truncateOcrDataAggressively(ocrData, categoria) {
    if (typeof ocrData === 'string') {
      return this.smartTruncate(ocrData, 10000);
    }

    const result = {};
    let totalChars = 0;
    const maxCharsPerField = 10000;

    for (const [key, value] of Object.entries(ocrData)) {
      if (totalChars > maxCharsPerField) break;

      if (typeof value === 'string') {
        const truncatedValue = this.smartTruncate(value, Math.min(2000, maxCharsPerField - totalChars));
        result[key] = truncatedValue;
        totalChars += truncatedValue.length;
      } else if (Array.isArray(value)) {
        result[key] = value.slice(0, Math.min(3, value.length));
        totalChars += JSON.stringify(result[key]).length;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this._truncateOcrDataAggressively(value, categoria);
        totalChars += JSON.stringify(result[key]).length;
      } else {
        result[key] = value;
        totalChars += String(value).length;
      }
    }

    return result;
  }

  /**
   * Obtener datos mínimos del OCR
   */
  _getMinimalOcrData(ocrData, categoria) {
    if (typeof ocrData === 'string') {
      return this.smartTruncate(ocrData, 5000);
    }

    switch (categoria) {
      case 'CEDULA':
        return {
          text: this.smartTruncate(ocrData.text || JSON.stringify(ocrData), 5000)
        };
      case 'LICENCIA':
        return {
          text: this.smartTruncate(ocrData.text || JSON.stringify(ocrData), 5000)
        };
      case 'CONTRATO':
        return {
          text: this.smartTruncate(ocrData.text || JSON.stringify(ocrData), 8000)
        };
      default:
        return {
          text: this.smartTruncate(JSON.stringify(ocrData), 5000)
        };
    }
  }

  /**
   * Generar system prompt
   */
  _generarSystemPrompt() {
    return "Eres un asistente especializado en extraer información de documentos colombianos. Debes responder ÚNICAMENTE con JSON válido, sin texto adicional antes o después. No incluyas explicaciones, comentarios ni texto extra. Solo el JSON solicitado. IMPORTANTE: Todos los valores de texto en el JSON deben estar en MAYÚSCULAS (uppercase).";
  }

  /**
   * Generar user prompt
   */
  _generarUserPrompt(ocrData, categoria, conductorExistente = null) {
    const ocrText = typeof ocrData === 'string' ? ocrData : JSON.stringify(ocrData);
    const specificPrompt = this.getSpecificPrompt(categoria);

    return `Analiza el siguiente texto OCR de un documento ${categoria} y extrae la información estructurada.\n\n${specificPrompt}\n\nTexto OCR:\n${ocrText}`;
  }

  /**
   * Obtener prompt específico según el tipo
   */
  getSpecificPrompt(categoria) {
    switch (categoria) {
      case 'CEDULA':
        return this.buildCedulaPrompt();
      case 'LICENCIA':
        return this.buildLicenciaPrompt();
      case 'CONTRATO':
        return this.buildContratoPrompt();
      default:
        return '{}';
    }
  }

  /**
   * Limpiar y extraer JSON de la respuesta
   */
  _extractAndParseJSON(responseText, categoria) {
    try {
      let jsonText = responseText.trim();

      const firstBrace = jsonText.indexOf('{');
      const lastBrace = jsonText.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      }

      return JSON.parse(jsonText);
    } catch (parseError) {
      console.error(`❌ Error parseando JSON para ${categoria}:`, parseError.message);
      console.error(`📝 Respuesta original:`, responseText);

      return this._getFallbackResponse(categoria);
    }
  }

  /**
   * Obtener respuesta de fallback cuando el JSON falla
   */
  _getFallbackResponse(categoria) {
    switch (categoria) {
      case 'CEDULA':
        return {
          nombre: "",
          apellido: "",
          tipo_identificacion: "CC",
          numero_identificacion: "",
          fecha_nacimiento: "",
          genero: "",
          tipo_sangre: ""
        };
      case 'LICENCIA':
        return {
          numero_licencia: "",
          categorias: [],
          fecha_expedicion: "",
          fecha_vencimiento: "",
          restricciones: "",
          organismo: ""
        };
      case 'CONTRATO':
        return {
          email: "",
          telefono: "",
          direccion: "",
          fecha_ingreso: "",
          salario_base: "",
          termino_contrato: "",
          fecha_terminacion: "",
          sede_trabajo: ""
        };
      default:
        return {};
    }
  }

  /**
   * Llamar a la API de Ministral con system y user prompts separados
   */
  async _callMinistralAPI(systemPrompt, userPrompt, categoria) {
    try {
      const totalLength = systemPrompt.length + userPrompt.length;

      const response = await this.client.path("/chat/completions").post({
        body: {
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: userPrompt
            }
          ],
          model: modelName,
          max_tokens: 4000,
          temperature: 0.1
        }
      });

      if (response.status !== "200") {
        throw new Error(`Error en Ministral API: ${response.status}`);
      }

      const result = response.body.choices[0].message.content;

      return this._extractAndParseJSON(result, categoria);

    } catch (error) {
      console.error(`❌ Error de Ministral API para ${categoria}:`, error);
      throw error;
    }
  }

  /**
   * Procesar datos OCR de conductor usando Ministral-3B (MÉTODO PRINCIPAL)
   */
  async procesarDatosConductor(ocrData, categoria, conductorExistente = null) {
    try {
      const ocrDataTruncated = this._truncateOcrDataAggressively(ocrData, categoria);

      const systemPrompt = this._generarSystemPrompt();
      const userPrompt = this._generarUserPrompt(ocrDataTruncated, categoria, conductorExistente);

      const promptSize = systemPrompt.length + userPrompt.length;

      if (promptSize > 15000) {
        const ocrDataMinimal = this._getMinimalOcrData(ocrData, categoria);
        const minimalUserPrompt = this._generarUserPrompt(ocrDataMinimal, categoria, conductorExistente);
        return this._callMinistralAPI(systemPrompt, minimalUserPrompt, categoria);
      }

      return this._callMinistralAPI(systemPrompt, userPrompt, categoria);

    } catch (error) {
      console.error(`❌ Error procesando ${categoria} con Ministral:`, error.message);
      throw error;
    }
  }

  /**
   * Prompt específico para cédula - CORREGIDO CON UPPERCASE
   */
  buildCedulaPrompt() {
    return `
Extrae la siguiente información de la cédula de ciudadanía colombiana.

IMPORTANTE: Lee cuidadosamente la cédula para diferenciar entre NOMBRES y APELLIDOS:

En las cédulas colombianas el orden es:
1. NÚMERO DE DOCUMENTO (aparece primero)
2. APELLIDOS (aparecen después del número de documento)
3. NOMBRES (aparecen después de los apellidos)

- NO copies el mismo texto para nombre y apellido
- Los nombres y apellidos son diferentes campos de información
- Lee en orden: número → apellidos → nombres

⚠️ REGLA CRÍTICA: Todos los valores de texto deben estar en MAYÚSCULAS (uppercase).

Extrae esta información:
{
  "numero_identificacion": "número de identificación del documento (campo OBLIGATORIO)",
  "nombre": "SOLO los nombres de la persona EN MAYÚSCULAS (ejemplo: 'JUAN CARLOS', 'MARÍA FERNANDA', 'YORK ESTEBAN'). NO incluyas apellidos aquí",
  "apellido": "SOLO los apellidos de la persona EN MAYÚSCULAS (ejemplo: 'GARCÍA LÓPEZ', 'MARTÍNEZ', 'RODRÍGUEZ SILVA'). NO incluyas nombres aquí",
  "tipo_identificacion": "tipo de documento EN MAYÚSCULAS (CC, TI, CE, etc.)",
  "nombre": "SOLO los nombres de la persona EN MAYÚSCULAS (ejemplo: 'JUAN CARLOS', 'MARÍA FERNANDA', 'YORK ESTEBAN'). NO incluyas apellidos aquí",
  "apellido": "SOLO los apellidos de la persona EN MAYÚSCULAS (ejemplo: 'GARCÍA LÓPEZ', 'MARTÍNEZ', 'RODRÍGUEZ SILVA'). NO incluyas nombres aquí",
  "tipo_identificacion": "tipo de documento EN MAYÚSCULAS (CC, TI, CE, etc.)",
  "fecha_nacimiento": "fecha de nacimiento en formato YYYY-MM-DD",
  "genero": "género EN MAYÚSCULAS (M para masculino, F para femenino)",
  "tipo_sangre": "tipo de sangre EN MAYÚSCULAS (A+, A-, B+, B-, AB+, AB-, O+, O-). Si encuentras '0+' o '0-', cámbialo por 'O+' o 'O-'"
}

EJEMPLOS DE DIFERENCIACIÓN (orden en la cédula):
- Si la cédula dice "1.118.571.552 MARTÍNEZ LÓPEZ YORK ESTEBAN"
  - numero_identificacion: "1118571552" (sin puntos ni espacios)
  - apellido: "MARTÍNEZ LÓPEZ" (viene después del número)
  - nombre: "YORK ESTEBAN" (viene después del apellido)

- Si la cédula dice "12.345.678 GARCÍA RODRÍGUEZ MARÍA FERNANDA"
  - numero_identificacion: "12345678" (sin puntos ni espacios)
  - apellido: "GARCÍA RODRÍGUEZ" (viene después del número)
  - nombre: "MARÍA FERNANDA" (viene después del apellido)

REGLAS IMPORTANTES:
1. TODOS LOS VALORES DE TEXTO DEBEN ESTAR EN MAYÚSCULAS
2. El numero_identificacion es OBLIGATORIO y debe extraerse sin puntos, comas ni espacios
3. ORDEN DE LECTURA: número documento → apellidos → nombres
4. Si nombre y apellido son exactamente iguales, revisa de nuevo la cédula siguiendo el orden correcto
5. Los apellidos van DESPUÉS del número de documento
6. Los nombres van DESPUÉS de los apellidos  
7. Si no encuentras algún campo, déjalo como string vacío ""
8. Asegúrate de que tipo_sangre use la letra 'O' no el número '0'
2. ORDEN DE LECTURA: número documento → apellidos → nombres
3. Si nombre y apellido son exactamente iguales, revisa de nuevo la cédula siguiendo el orden correcto
4. Los apellidos van DESPUÉS del número de documento
5. Los nombres van DESPUÉS de los apellidos  
6. Si no encuentras algún campo, déjalo como string vacío ""
7. Asegúrate de que tipo_sangre use la letra 'O' no el número '0'

Responde ÚNICAMENTE con el JSON, sin texto adicional.`;
  }

  buildLicenciaPrompt() {
    return `
Extrae la siguiente información de la licencia de conducción colombiana:

⚠️ REGLA CRÍTICA: Todos los valores de texto deben estar en MAYÚSCULAS (uppercase).

IMPORTANTE: En la licencia de conducción aparecen DOS números importantes:
1. NÚMERO DE LICENCIA (propio de la licencia)
2. NÚMERO DE IDENTIFICACIÓN (cédula del titular)

{
  "numero_identificacion": "número de cédula del titular de la licencia (campo OBLIGATORIO)",
  "numero_licencia": "número de la licencia de conducción",
  "categorias": [
    {
      "categoria": "categoría de la licencia EN MAYÚSCULAS (A1, A2, B1, B2, B3, C1, C2, C3)",
      "vigencia_hasta": "fecha de vencimiento en formato YYYY-MM-DD"
    }
  ],
  "fecha_expedicion": "fecha de expedición en formato YYYY-MM-DD",
  "fecha_vencimiento": "fecha de vencimiento general en formato YYYY-MM-DD",
  "restricciones": "restricciones si las hay EN MAYÚSCULAS",
  "organismo": "organismo que expide la licencia EN MAYÚSCULAS"
}

REGLAS IMPORTANTES:
1. TODOS LOS VALORES DE TEXTO DEBEN ESTAR EN MAYÚSCULAS
2. numero_identificacion es OBLIGATORIO - es el número de cédula del titular (sin puntos ni espacios)
3. numero_licencia es diferente al numero_identificacion
4. Para categorias, incluye todas las categorías encontradas en el documento
5. Las categorías deben estar en MAYÚSCULAS (A1, A2, B1, B2, B3, C1, C2, C3)
6. Si no encuentras algún campo, déjalo como string vacío "" o array vacío []
7. Las fechas mantienen el formato YYYY-MM-DD (no necesitan mayúsculas)
2. Para categorias, incluye todas las categorías encontradas en el documento
3. Las categorías deben estar en MAYÚSCULAS (A1, A2, B1, B2, B3, C1, C2, C3)
4. Si no encuentras algún campo, déjalo como string vacío "" o array vacío []
5. Las fechas mantienen el formato YYYY-MM-DD (no necesitan mayúsculas)

Responde ÚNICAMENTE con el JSON, sin texto adicional.`;
  }

  buildContratoPrompt() {
    return `
Extrae la siguiente información del contrato de trabajo:

⚠️ REGLA CRÍTICA: Todos los valores de texto deben estar en MAYÚSCULAS (uppercase).

{
  "numero_identificacion": "número de cédula del empleado (campo OBLIGATORIO)",
  "email": "correo electrónico del conductor EN MAYÚSCULAS",
  "telefono": "número de teléfono del conductor",
  "direccion": "dirección de residencia del conductor EN MAYÚSCULAS",
  "fecha_ingreso": "fecha de ingreso en formato YYYY-MM-DD",
  "salario_base": "salario base como número (sin puntos ni comas)",
  "termino_contrato": "término del contrato EN MAYÚSCULAS (INDEFINIDO, FIJO, etc.)",
  "fecha_terminacion": "fecha de terminación del contrato en formato YYYY-MM-DD",
  "sede_trabajo": "sede de trabajo EN MAYÚSCULAS (YOPAL, VILLANUEVA, o TAURAMENA)"
}

REGLAS IMPORTANTES:
1. TODOS LOS VALORES DE TEXTO DEBEN ESTAR EN MAYÚSCULAS
2. numero_identificacion es OBLIGATORIO - es el número de cédula del empleado (puede venir con puntos o espacios, pero debes extraer solo el número sin símbolos)
3. Para email, convierte todo a mayúsculas (ej: USUARIO@EMPRESA.COM)
4. Para dirección, convierte toda la dirección a mayúsculas
5. Para término de contrato, usa: INDEFINIDO, FIJO, TEMPORAL, etc.
6. Para salario_base, extrae solo el número sin símbolos
7. Para sede_trabajo, usa exactamente: YOPAL, VILLANUEVA, o TAURAMENA (EN MAYÚSCULAS)
8. Las fechas mantienen el formato YYYY-MM-DD (no necesitan mayúsculas)
9. Los números de teléfono y salario no necesitan mayúsculas
10. Si no encuentras algún campo, déjalo como string vacío "" o null para salario_base
2. Para email, convierte todo a mayúsculas (ej: USUARIO@EMPRESA.COM)
3. Para dirección, convierte toda la dirección a mayúsculas
4. Para término de contrato, usa: INDEFINIDO, FIJO, TEMPORAL, etc.
5. Para salario_base, extrae solo el número sin símbolos
6. Para sede_trabajo, usa exactamente: YOPAL, VILLANUEVA, o TAURAMENA (EN MAYÚSCULAS)
7. Las fechas mantienen el formato YYYY-MM-DD (no necesitan mayúsculas)
8. Los números de teléfono y salario no necesitan mayúsculas
9. Si no encuentras algún campo, déjalo como string vacío "" o null para salario_base

Responde ÚNICAMENTE con el JSON, sin texto adicional.`;
  }

  /**
   * Combinar datos de múltiples documentos procesados - CORREGIDO
   */
  combinarDatosDocumentos(datosDocumentos) {
    try {
      // Detectar si los datos vienen organizados por categorías o como objeto plano
      const esObjetoPlano = !datosDocumentos.CEDULA && !datosDocumentos.LICENCIA && !datosDocumentos.CONTRATO;

      let conductorCompleto;

      if (esObjetoPlano) {
        // Los datos vienen como un objeto plano con todos los campos mezclados
        conductorCompleto = {
          // Campos del modelo - usar directamente los datos del objeto plano
          nombre: datosDocumentos.nombre || "",
          apellido: datosDocumentos.apellido || "",
          tipo_identificacion: datosDocumentos.tipo_identificacion || "CC",
          numero_identificacion: datosDocumentos.numero_identificacion || "",
          email: datosDocumentos.email || null,
          telefono: datosDocumentos.telefono || "",
          fecha_nacimiento: datosDocumentos.fecha_nacimiento || null,
          genero: datosDocumentos.genero || null,
          direccion: datosDocumentos.direccion || null,
          fecha_ingreso: datosDocumentos.fecha_ingreso || null,
          salario_base: datosDocumentos.salario_base ?
            parseFloat(datosDocumentos.salario_base) : null,
          termino_contrato: datosDocumentos.termino_contrato || null,
          fecha_terminacion: datosDocumentos.fecha_terminacion || null,
          sede_trabajo: datosDocumentos.sede_trabajo || null,
          tipo_sangre: normalizarTipoSangre(datosDocumentos.tipo_sangre) || null,

          // Licencia como JSONB según el modelo
          licencia_conduccion: (datosDocumentos.numero_licencia || datosDocumentos.categorias) ? {
            numero_licencia: datosDocumentos.numero_licencia || "",
            fecha_expedicion: datosDocumentos.fecha_expedicion || "",
            organismo: datosDocumentos.organismo || "",
            restricciones: datosDocumentos.restricciones || "",
            categorias: datosDocumentos.categorias || []
          } : null,

          // Metadatos
          fechaProcesamiento: new Date().toISOString(),
          documentosProcesados: this._detectarDocumentosProcesados(datosDocumentos)
        };
      } else {
        // Los datos vienen organizados por categorías (formato original)
        conductorCompleto = {
          // Campos del modelo mapeados correctamente
          nombre: datosDocumentos.CEDULA?.nombre || "",
          apellido: datosDocumentos.CEDULA?.apellido || "",
          tipo_identificacion: datosDocumentos.CEDULA?.tipo_identificacion || "CC",
          numero_identificacion: datosDocumentos.CEDULA?.numero_identificacion || "",
          email: datosDocumentos.CONTRATO?.email || null,
          telefono: datosDocumentos.CONTRATO?.telefono || "",
          fecha_nacimiento: datosDocumentos.CEDULA?.fecha_nacimiento || null,
          genero: datosDocumentos.CEDULA?.genero || null,
          direccion: datosDocumentos.CONTRATO?.direccion || null,
          fecha_ingreso: datosDocumentos.CONTRATO?.fecha_ingreso || null,
          salario_base: datosDocumentos.CONTRATO?.salario_base ?
            parseFloat(datosDocumentos.CONTRATO.salario_base) : null,
          termino_contrato: datosDocumentos.CONTRATO?.termino_contrato || null,
          fecha_terminacion: datosDocumentos.CONTRATO?.fecha_terminacion || null,
          sede_trabajo: datosDocumentos.CONTRATO?.sede_trabajo || null,
          tipo_sangre: normalizarTipoSangre(datosDocumentos.CEDULA?.tipo_sangre) || null,

          // Licencia como JSONB según el modelo
          licencia_conduccion: datosDocumentos.LICENCIA ? {
            numero_licencia: datosDocumentos.LICENCIA.numero_licencia || "",
            fecha_expedicion: datosDocumentos.LICENCIA.fecha_expedicion || "",
            organismo: datosDocumentos.LICENCIA.organismo || "",
            restricciones: datosDocumentos.LICENCIA.restricciones || "",
            categorias: datosDocumentos.LICENCIA.categorias || []
          } : null,

          // Metadatos
          fechaProcesamiento: new Date().toISOString(),
          documentosProcesados: Object.keys(datosDocumentos).filter(key =>
            datosDocumentos[key] && Object.keys(datosDocumentos[key]).length > 0
          )
        };
      }

      return conductorCompleto;

    } catch (error) {
      console.error('❌ Error combinando datos de documentos:', error);
      throw new Error(`Error combinando datos: ${error.message}`);
    }
  }

  /**
   * Detectar qué tipos de documentos fueron procesados basándose en los campos presentes
   * @private
   */
  _detectarDocumentosProcesados(datos) {
    const documentos = [];

    // Campos típicos de CEDULA
    if (datos.nombre || datos.apellido || datos.numero_identificacion || datos.fecha_nacimiento || datos.genero || datos.tipo_sangre) {
      documentos.push('CEDULA');
    }

    // Campos típicos de LICENCIA
    if (datos.numero_licencia || datos.categorias || datos.fecha_expedicion || datos.organismo) {
      documentos.push('LICENCIA');
    }

    // Campos típicos de CONTRATO
    if (datos.email || datos.telefono || datos.direccion || datos.fecha_ingreso || datos.salario_base || datos.sede_trabajo) {
      documentos.push('CONTRATO');
    }

    return documentos.length > 0 ? documentos : ['DESCONOCIDO'];
  }

  /**
   * Validar datos combinados según el modelo de Conductor - CORREGIDO
   */
  validarDatosCombinados(datosCompletos) {
    const errores = [];
    const advertencias = [];

    // Validaciones críticas (campos requeridos del modelo)
    if (!datosCompletos.nombre || datosCompletos.nombre.trim() === '') {
      errores.push("El nombre es obligatorio");
    }

    if (!datosCompletos.apellido || datosCompletos.apellido.trim() === '') {
      errores.push("El apellido es obligatorio");
    }

    if (!datosCompletos.numero_identificacion || datosCompletos.numero_identificacion.trim() === '') {
      errores.push("El número de identificación es obligatorio");
    }

    if (!datosCompletos.telefono || datosCompletos.telefono.trim() === '') {
      errores.push("El teléfono es obligatorio");
    }

    if (!datosCompletos.fecha_ingreso) {
      errores.push("La fecha de ingreso es obligatoria");
    }

    if (datosCompletos.salario_base === undefined || datosCompletos.salario_base === null) {
      errores.push("El salario base es obligatorio");
    }

    // Validaciones de formato
    if (datosCompletos.email && !this._validarEmail(datosCompletos.email)) {
      errores.push("El formato del email no es válido");
    }

    if (datosCompletos.fecha_nacimiento && !this._validarFecha(datosCompletos.fecha_nacimiento)) {
      errores.push("El formato de fecha de nacimiento no es válido (debe ser YYYY-MM-DD)");
    }

    if (datosCompletos.fecha_ingreso && !this._validarFecha(datosCompletos.fecha_ingreso)) {
      errores.push("El formato de fecha de ingreso no es válido (debe ser YYYY-MM-DD)");
    }

    // Validar licencia_conduccion JSONB
    if (datosCompletos.licencia_conduccion) {
      const licenciaErrors = this._validarLicenciaConduccion(datosCompletos.licencia_conduccion);
      errores.push(...licenciaErrors);
    }

    // Validar sede_trabajo ENUM
    if (datosCompletos.sede_trabajo &&
      !['YOPAL', 'VILLANUEVA', 'TAURAMENA'].includes(datosCompletos.sede_trabajo)) {
      errores.push("La sede de trabajo debe ser YOPAL, VILLANUEVA o TAURAMENA");
    }

    // Validar tipo_sangre ENUM
    if (datosCompletos.tipo_sangre &&
      !['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].includes(datosCompletos.tipo_sangre)) {
      errores.push("El tipo de sangre debe ser uno de: A+, A-, B+, B-, AB+, AB-, O+, O-");
    }

    // Validaciones opcionales (advertencias)
    if (!datosCompletos.email) {
      advertencias.push("Email no encontrado");
    }

    if (!datosCompletos.fecha_nacimiento) {
      advertencias.push("Fecha de nacimiento no encontrada");
    }

    if (!datosCompletos.direccion) {
      advertencias.push("Dirección no encontrada");
    }

    if (!datosCompletos.licencia_conduccion) {
      advertencias.push("Información de licencia de conducción no encontrada");
    }

    if (!datosCompletos.sede_trabajo) {
      advertencias.push("Sede de trabajo no encontrada");
    }

    return {
      valido: errores.length === 0,
      errores,
      advertencias,
      completitud: this._calcularCompletitud(datosCompletos)
    };
  }

  /**
   * Validar estructura de licencia_conduccion JSONB
   */
  _validarLicenciaConduccion(licencia) {
    const errores = [];

    if (!licencia.fecha_expedicion || !this._validarFecha(licencia.fecha_expedicion)) {
      errores.push("La fecha de expedición de la licencia debe tener formato YYYY-MM-DD");
    }

    if (!Array.isArray(licencia.categorias)) {
      errores.push("Las categorías de la licencia deben ser un array");
    } else {
      const categoriasValidas = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];

      licencia.categorias.forEach((cat, index) => {
        if (!cat.categoria || !categoriasValidas.includes(cat.categoria)) {
          errores.push(`Categoría ${index + 1}: debe ser una de ${categoriasValidas.join(', ')}`);
        }

        if (!cat.vigencia_hasta || !this._validarFecha(cat.vigencia_hasta)) {
          errores.push(`Categoría ${index + 1}: vigencia_hasta debe tener formato YYYY-MM-DD`);
        }
      });
    }

    return errores;
  }

  /**
   * Validar formato de email
   */
  _validarEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validar formato de fecha YYYY-MM-DD
   */
  _validarFecha(fecha) {
    const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!fechaRegex.test(fecha)) return false;

    const date = new Date(fecha);
    return date instanceof Date && !isNaN(date);
  }

  /**
   * Calcular porcentaje de completitud de los datos del conductor
   */
  _calcularCompletitud(datos) {
    const camposImportantes = [
      'nombre', 'apellido', 'numero_identificacion', 'telefono',
      'email', 'fecha_nacimiento', 'direccion', 'licencia_conduccion',
      'sede_trabajo', 'fecha_ingreso', 'salario_base', 'tipo_sangre'
    ];

    let camposCompletos = 0;

    camposImportantes.forEach(campo => {
      const valor = datos[campo];
      if (valor !== null && valor !== undefined && valor !== '') {
        camposCompletos++;
      }
    });

    return Math.round((camposCompletos / camposImportantes.length) * 100);
  }
}

// Función auxiliar para usar el servicio
async function procesarDatosOCRConMinistral(ocrData, categoria, conductorExistente = null) {
  const service = new MinistralConductorService();
  return await service.procesarDatosConductor(ocrData, categoria, conductorExistente);
}

function normalizarTipoSangre(tipoSangre) {
  if (!tipoSangre) return null;

  // Convertir 0 a O si es necesario
  return tipoSangre.replace(/^0([+-])$/, 'O$1');
}


module.exports = {
  MinistralConductorService,
  procesarDatosOCRConMinistral
};