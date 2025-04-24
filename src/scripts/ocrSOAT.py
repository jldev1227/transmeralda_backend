import json
import re
from datetime import datetime
import unicodedata
import sys
import os
import argparse
import traceback

# Función para normalizar texto
def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8').upper()

class SOATProcessor:
    def __init__(self, ocr_data, placa_param=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.placa_param = placa_param
        self.result = {
            "placa": None,
            "soatVencimiento": None,
        }
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def is_valid_soat(self):
        """Verificar si el documento es un SOAT válido"""
        # Buscar términos clave del SOAT en las primeras líneas
        keywords = ["ASEGURADORA", "SOAT", "SEGURO OBLIGATORIO", "ACCIDENTES DE TRANSITO", 
                   "POLIZA", "PÓLIZA", "SEGURO", "COMPAÑÍA", "COMPANIA"]
        
        for keyword in keywords:
            if self.find_line_index(keyword) >= 0:
                return True
        return False
    
    def extract_placa(self):
        """Extraer la placa del vehículo"""
        # Si tenemos una placa proporcionada como parámetro, usarla para buscarla en el contenido
        if self.placa_param:
            # Convertir a mayúsculas para hacer la comparación insensible a mayúsculas/minúsculas
            placa_buscar = self.placa_param.upper()
            
            # Buscar la placa en todo el contenido
            for line in self.lines:
                normalized_line = normalize_text(line)
                if placa_buscar in normalized_line:
                    # Si encuentra la placa en el contenido, la establece como resultado
                    self.result["placa"] = self.placa_param
                    return True
                    
            # Si llegamos aquí, la placa no se encontró en el contenido
            return False
                
        # Si no hay placa como parámetro, mantén el comportamiento anterior con regex
        placa_idx = self.find_line_index("PLACA")
        if placa_idx >= 0:
            # Buscar en esta línea y las siguientes
            for i in range(placa_idx, min(placa_idx + 5, len(self.lines))):
                match = re.search(r'[A-Z]{3}\d{3}', self.lines[i])
                if match:
                    self.result["placa"] = match.group(0)
                    return True
        
        # Si no encuentra con "PLACA", buscar patrón de placa en todas las líneas
        for line in self.lines:
            match = re.search(r'[A-Z]{3}\d{3}', line)
            if match:
                self.result["placa"] = match.group(0)
                return True
        
        return False

    def extract_fecha_vencimiento(self):
        """Extraer fecha de vencimiento del SOAT"""
        # Buscar términos relacionados con la fecha de vencimiento
        vencimiento_keywords = [
            "VIGENCIA HASTA", "FECHA VENCIMIENTO", "VENCE", 
            "VENCIMIENTO", "VIGENTE HASTA", "VIGENCIA", "HASTA"
        ]
        
        # 1. Primero buscar líneas que contengan palabras clave de vencimiento
        for keyword in vencimiento_keywords:
            venc_idx = self.find_line_index(keyword)
            if venc_idx >= 0:
                # Buscar una fecha en la misma línea o en las siguientes 3 líneas
                for i in range(venc_idx, min(venc_idx + 4, len(self.lines))):
                    line = self.lines[i]
                    
                    # Buscar fechas en formatos comunes
                    # Formato YYYY-MM-DD o YYYY/MM/DD
                    match = re.search(r'(20\d{2})[-/](\d{1,2})[-/](\d{1,2})', line)
                    if match:
                        year, month, day = match.groups()
                        try:
                            fecha = datetime(int(year), int(month), int(day))
                            self.result["soatVencimiento"] = fecha.strftime("%Y-%m-%d")
                            return True
                        except ValueError:
                            pass
                    
                    # Formato DD-MM-YYYY o DD/MM/YYYY
                    match = re.search(r'(\d{1,2})[-/](\d{1,2})[-/](20\d{2})', line)
                    if match:
                        day, month, year = match.groups()
                        try:
                            fecha = datetime(int(year), int(month), int(day))
                            self.result["soatVencimiento"] = fecha.strftime("%Y-%m-%d")
                            return True
                        except ValueError:
                            pass
        
        # 2. Si no se encontró con palabras clave, buscar todas las fechas potenciales
        todas_fechas = []
        
        # Buscar fechas en cualquier línea
        for line in self.lines:
            # Formato YYYY-MM-DD o YYYY/MM/DD
            for match in re.finditer(r'(20\d{2})[-/\s](\d{1,2})[-/\s](\d{1,2})', line):
                year, month, day = match.groups()
                try:
                    fecha = datetime(int(year), int(month), int(day))
                    todas_fechas.append(fecha)
                except ValueError:
                    pass
            
            # Formato DD-MM-YYYY o DD/MM/YYYY
            for match in re.finditer(r'(\d{1,2})[-/\s](\d{1,2})[-/\s](20\d{2})', line):
                day, month, year = match.groups()
                try:
                    fecha = datetime(int(year), int(month), int(day))
                    todas_fechas.append(fecha)
                except ValueError:
                    pass
        
        # Seleccionar la fecha futura más cercana como vencimiento
        if todas_fechas:
            fecha_actual = datetime.now()
            fechas_futuras = [fecha for fecha in todas_fechas if fecha > fecha_actual]
            
            if fechas_futuras:
                # Si hay fechas futuras, tomar la más cercana
                fecha_vencimiento = min(fechas_futuras)
            else:
                # Si no hay fechas futuras, tomar la más reciente
                fecha_vencimiento = max(todas_fechas)
                
            self.result["soatVencimiento"] = fecha_vencimiento.strftime("%Y-%m-%d")
            return True
            
        return False
    
    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_soat():
            return {"error": "No es un SOAT válido"}
        
        self.extract_placa()
        self.extract_fecha_vencimiento()
        
        return self.result

# Función principal para procesar el OCR
def process_soat_data(data, placa_param=None):
    try:
        processor = SOATProcessor(data, placa_param)
        result = processor.process()
        return result
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}

# Ejecución principal
if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser(description='Procesar datos OCR')
        parser.add_argument('--file', type=str, help='Ruta al archivo JSON con datos OCR')
        parser.add_argument('--placa', type=str, help='Placa del vehículo (opcional)')
        
        args = parser.parse_args()
        
        # Determinar qué archivo procesar
        file_path = None
        
        if args.file:
            # Usar el archivo especificado por argumento
            file_path = args.file
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo no encontrado: {file_path}"}))
                sys.exit(1)
        elif len(sys.argv) > 1 and not sys.argv[1].startswith('--'):
            # Si el primer argumento no es una opción, intentar interpretarlo como JSON
            try:
                data = json.loads(sys.argv[1])
                # Si llegamos aquí, el JSON se parseó correctamente, no necesitamos archivo
                file_path = None
            except json.JSONDecodeError:
                print("ERROR: El primer argumento no es JSON válido", file=sys.stderr)
                print(json.dumps({"error": "Argumento no es JSON válido"}))
                sys.exit(1)
        else:
            # Usar archivo por defecto
            file_path = 'temp/tempOcrData_SOAT.json'
            if not os.path.exists(file_path):
                print(f"ERROR: El archivo por defecto {file_path} no existe", file=sys.stderr)
                print(json.dumps({"error": f"Archivo por defecto no encontrado: {file_path}"}))
                sys.exit(1)
        
        # Leer datos si es necesario
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as file:
                    data = json.load(file)
            except json.JSONDecodeError as e:
                print(f"ERROR: El archivo no contiene JSON válido: {str(e)}", file=sys.stderr)
                print(json.dumps({"error": f"JSON inválido en archivo: {str(e)}"}))
                sys.exit(1)
        
        # Procesar los datos
        result = process_soat_data(data, args.placa)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)