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

class TarjetaOperacionProcessor:
    def __init__(self, ocr_data, placa_param=None):
        self.data = ocr_data
        self.content = ocr_data.get('analyzeResult', {}).get('content', '')
        self.lines = self.content.split('\n')
        self.placa_param = placa_param.upper() if placa_param else None
        self.result = {
            "placa": None,
            "tarjetaDeOperacionVencimiento": None,
        }
    
    def find_line_index(self, keyword, normalize=True):
        """Encontrar el índice de la línea que contiene una palabra clave"""
        keyword_norm = normalize_text(keyword) if normalize else keyword
        for i, line in enumerate(self.lines):
            line_norm = normalize_text(line) if normalize else line
            if keyword_norm in line_norm:
                return i
        return -1
    
    def is_valid_tarjeta_operacion(self):
        """Verificar si el documento es una Tarjeta de Operación válida"""
        # Buscar términos clave de la Tarjeta de Operación
        keywords = [
            "TARJETA DE OPERACION", "TARJETA DE OPERACIÓN", 
            "SERVICIO PUBLICO", "SERVICIO PÚBLICO",
            "MINISTERIO DE TRANSPORTE", "EMPRESA DE TRANSPORTE"
        ]
        
        for keyword in keywords:
            if self.find_line_index(keyword) >= 0:
                return True
        
        # Verificar también en las primeras 10 líneas del documento
        for i, line in enumerate(self.lines[:10]):
            if "TARJETA DE OPERACI" in normalize_text(line):
                return True
        
        return False
    
    def extract_placa(self):
        """Extraer la placa del vehículo"""
        # Si tenemos una placa de parámetro, verificar si está en el documento
        if self.placa_param:
            placa_presente = False
            for line in self.lines:
                if self.placa_param in normalize_text(line):
                    placa_presente = True
                    self.result["placa"] = self.placa_param
                    break
            
            # Si la placa no está presente, buscar cualquier placa
            if not placa_presente:
                self.buscar_cualquier_placa()
            
            return placa_presente
        else:
            # Si no hay placa de parámetro, buscar cualquier placa
            return self.buscar_cualquier_placa()
    
    def buscar_cualquier_placa(self):
        """Buscar cualquier patrón de placa en el documento"""
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
        """Extraer fecha de vencimiento de la Tarjeta de Operación"""
        # Buscar términos relacionados con la fecha de vencimiento
        vencimiento_keywords = [
            "VIGENCIA HASTA", "HASTA", "FECHA DE VENCIMIENTO", 
            "VENCIMIENTO", "VIGENTE HASTA", "VIGENCIA", "TERMINA"
        ]
        
        # Lista para almacenar todas las fechas encontradas
        fechas_encontradas = []
        
        # 1. Primero buscar líneas que contengan palabras clave de vencimiento
        for keyword in vencimiento_keywords:
            venc_idx = self.find_line_index(keyword)
            if venc_idx >= 0:
                # Buscar fechas en la misma línea o en las siguientes 3 líneas
                for i in range(venc_idx, min(venc_idx + 4, len(self.lines))):
                    line = self.lines[i]
                    
                    # Encontrar todas las fechas en la línea
                    # Formato YYYY-MM-DD o YYYY/MM/DD
                    for match in re.finditer(r'(20\d{2})[-/](\d{1,2})[-/](\d{1,2})', line):
                        year, month, day = match.groups()
                        try:
                            fecha = datetime(int(year), int(month), int(day))
                            fechas_encontradas.append(fecha)
                        except ValueError:
                            pass
                    
                    # Formato DD-MM-YYYY o DD/MM/YYYY
                    for match in re.finditer(r'(\d{1,2})[-/](\d{1,2})[-/](20\d{2})', line):
                        day, month, year = match.groups()
                        try:
                            fecha = datetime(int(year), int(month), int(day))
                            fechas_encontradas.append(fecha)
                        except ValueError:
                            pass
        
        # 2. Si no se encontraron fechas con palabras clave, buscar todas las fechas
        if not fechas_encontradas:
            for line in self.lines:
                # Formato YYYY-MM-DD o YYYY/MM/DD
                for match in re.finditer(r'(20\d{2})[-/](\d{1,2})[-/](\d{1,2})', line):
                    year, month, day = match.groups()
                    try:
                        fecha = datetime(int(year), int(month), int(day))
                        fechas_encontradas.append(fecha)
                    except ValueError:
                        pass
                
                # Formato DD-MM-YYYY o DD/MM/YYYY
                for match in re.finditer(r'(\d{1,2})[-/](\d{1,2})[-/](20\d{2})', line):
                    day, month, year = match.groups()
                    try:
                        fecha = datetime(int(year), int(month), int(day))
                        fechas_encontradas.append(fecha)
                    except ValueError:
                        pass
        
        # 3. Procesar las fechas encontradas
        if fechas_encontradas:
            # Ordenar fechas de más antigua a más reciente
            fechas_encontradas.sort()
            
            # Si hay más de una fecha, asumir que la última es la de vencimiento
            if len(fechas_encontradas) > 1:
                fecha_vencimiento = fechas_encontradas[-1]  # Tomar la última fecha (la más reciente)
            else:
                fecha_vencimiento = fechas_encontradas[0]  # Si solo hay una fecha, usar esa
            
            # Verificar también si hay fechas futuras
            fecha_actual = datetime.now()
            fechas_futuras = [fecha for fecha in fechas_encontradas if fecha > fecha_actual]
            
            if fechas_futuras:
                # Si hay fechas futuras, la más lejana probablemente es la de vencimiento
                fecha_vencimiento = max(fechas_futuras)
            
            self.result["tarjetaDeOperacionVencimiento"] = fecha_vencimiento.strftime("%Y-%m-%d")
            return True
            
        return False

    def process(self):
        """Procesar todos los campos y devolver el resultado"""
        if not self.is_valid_tarjeta_operacion():
            return {"error": "No es una Tarjeta de Operación válida"}
        
        placa_encontrada = self.extract_placa()
        self.extract_fecha_vencimiento()
        
        # Adaptar el formato del resultado para coincidir con el esperado
        return {
            "placa": self.result["placa"] if placa_encontrada else False,
            "tarjetaDeOperacionVencimiento": self.result["tarjetaDeOperacionVencimiento"] or "No encontrado",
        }

# Función principal para procesar el OCR
def process_tarjeta_operacion(data, placa_param=None):
    try:
        processor = TarjetaOperacionProcessor(data, placa_param)
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
            file_path = './src/temp/tempOcrDataTARJETA_DE_OPERACION.json'
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
        result = process_tarjeta_operacion(data)
        
        # Imprimir resultado como JSON (único output a stdout)
        print(json.dumps(result, indent=4, ensure_ascii=False))
        
    except Exception as e:
        # Errores a stderr para depuración
        print(f"ERROR inesperado: {str(e)}", file=sys.stderr)
        print(f"Traceback: {traceback.format_exc()}", file=sys.stderr)
        
        # Error en formato JSON a stdout para que el proceso JS pueda capturarlo
        print(json.dumps({"error": str(e)}))
        sys.exit(1)