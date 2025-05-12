// genericExportController.js
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const fs_export = require("fs");
const os = require("os");

/**
 * Controlador genérico para exportar cualquier tipo de datos a Excel
 */
class GenericExportController {
  /**
   * Exporta cualquier array de datos a Excel utilizando un script Python
   *
   * @param {Array} data - Array de objetos con los datos a exportar
   * @param {Object} options - Opciones adicionales para la exportación
   * @returns {Promise<Object>} - Objeto con información del archivo generado
   */
  async exportToExcel(req, res) {
    const { data, options } = req.body;

    try {
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error("No hay datos para exportar");
      }

      // Asegurar que tenemos un array (incluso si es un solo objeto)
      const dataArray = Array.isArray(data) ? data : [data];

      // Convertir el array a JSON string para pasarlo como argumento
      const jsonString = JSON.stringify(dataArray);

      const tempFilePath = path.join(
        os.tmpdir(),
        `export-data-${Date.now()}.json`
      );
      await fs.writeFile(tempFilePath, jsonString);

      // Configurar el directorio y nombre del archivo
      const outputDir =
        options.outputDir || path.join(process.cwd(), "exports");
      await fs.mkdir(outputDir, { recursive: true });

      // Generar el nombre del archivo
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      let filename = options.filename;

      if (!filename) {
        // Intentar determinar un nombre adecuado basado en los datos
        let prefix = "datos";
        if (dataArray.length > 0) {
          const keys = Object.keys(dataArray[0]);
          // Buscar claves comunes para determinar el tipo de datos
          const keyString = keys.join(" ").toLowerCase();

          if (keyString.includes("liquidacion") || keyString.includes("pago")) {
            prefix = "liquidaciones";
          } else if (
            keyString.includes("vehiculo") ||
            keyString.includes("placa")
          ) {
            prefix = "vehiculos";
          } else if (
            keyString.includes("conductor") ||
            keyString.includes("empleado")
          ) {
            prefix = "conductores";
          } else if (keys.length > 0) {
            // Usar la primera clave como prefijo o dejar el predeterminado
            prefix = keys[0].toLowerCase().replace(/[^a-z0-9]/g, "_");
          }
        }
        filename = `${prefix}_${timestamp}.xlsx`;
      }

      const outputPath = path.join(outputDir, filename);

      // Configurar la ruta al script Python
      // Modifica esta línea en genericExportController.js
      const scriptPath = path.join(
        process.cwd(),
        "src",
        "scripts",
        "exportDataXLSX.py"
      );
      // O si está en otro lugar
      // Comprobar si el script existe
      try {
        await fs.access(scriptPath);
      } catch (error) {
        console.error(`Script no encontrado en: ${scriptPath}`);
        throw new Error("Script de exportación no encontrado");
      }

      // Ejecutar el script Python con los datos
      const result = await GenericExportController._executeScript(scriptPath, [
        tempFilePath,
        outputPath,
      ]);

      if (!result.success) {
        throw new Error(
          result.error || "Error al ejecutar el script de exportación"
        );
      }

      // El script se ejecutó correctamente pero puede haber advertencias
      if (result.output && result.output.includes("Warning")) {
        console.warn("El script completó con advertencias:", result.output);
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="liquidacion.xlsx"'
      );
  
      // Usar fs_regular en lugar de fs para createReadStream
      const fileStream = fs_export.createReadStream(outputPath);  // Cambia tempFilePath por outputPath
      fileStream.pipe(res);
  
      // Eliminar el archivo Excel una vez enviado
      fileStream.on("end", () => {
        fs_export.unlinkSync(outputPath);  // Cambiar a outputPath y usar fs_regular
      });
    } catch (error) {
      console.error("Error en exportación a Excel:", error);
      return {
        success: false,
        message: error.message || "Error desconocido al exportar datos",
        error,
      };
    }
  }

  /**
   * Ejecuta el script Python con los argumentos especificados
   *
   * @param {string} scriptPath - Ruta al script Python
   * @param {Array} args - Argumentos para el script
   * @returns {Promise<Object>} - Resultado de la ejecución
   * @private
   */
  static _executeScript(scriptPath, args) {
    return new Promise((resolve) => {
      // Crear proceso Python
      const pythonProcess = spawn("python", [scriptPath, ...args]);

      let stdoutData = "";
      let stderrData = "";

      // Capturar la salida estándar
      pythonProcess.stdout.on("data", (data) => {
        stdoutData += data.toString();
      });

      // Capturar los errores
      pythonProcess.stderr.on("data", (data) => {
        stderrData += data.toString();
        console.error(`Error en script Python: ${data.toString()}`);
      });

      // Manejar finalización del proceso
      pythonProcess.on("close", (code) => {
        // Si el código de salida es 0, es un éxito incluso si hay advertencias
        if (code === 0) {
          // Extraer la ruta del archivo generado (última línea de la salida)
          const outputPath = stdoutData.trim().split("\n").pop();

          resolve({
            success: true,
            code,
            output: stdoutData,
            outputPath,
          });
        } else {
          resolve({
            success: false,
            code,
            error:
              stderrData || `El script terminó con código de error: ${code}`,
          });
        }
      });

      // Manejar errores del proceso
      pythonProcess.on("error", (err) => {
        resolve({
          success: false,
          error: `Error al ejecutar Python: ${err.message}`,
        });
      });
    });
  }
}

module.exports = new GenericExportController();
