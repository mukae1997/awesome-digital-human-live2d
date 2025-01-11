import serial
import time
import threading
from flask import Flask, jsonify
from flask_cors import CORS

# 打开串口，这里的'COM3'应该替换为你的实际串口号
ser = serial.Serial('COM4',9600)  # 请替换为你的串口号

def renew(): 
    global current_speaker
    try:
        while True:
            if ser.in_waiting > 0:
                incoming_data = ser.readline().decode('utf-8').rstrip()  # 读取一行数据并解码
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {incoming_data}")  # 打印读取到的数据和时间戳
                # 在这里可以添加处理接收到的数据的代码
                current_speaker = incoming_data
            else:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No data received")
                current_speaker = -1
            time.sleep(0.02)  
    
    except KeyboardInterrupt:
        print("程序被用户中断")
    
    finally:
        ser.close()  # 关闭串口连接

app = Flask(__name__)
CORS(app)
current_speaker='8' 
@app.route('/get_current_speaker', methods=['GET'])
def get_current_time():
    current_time = time.time()  # 获取当前时间戳
    global current_speaker
    response = {
        'status_code': 200,
        'message': 'Success',
        'current_speaker': current_speaker
    }
    return jsonify(response)

def run_server():
    app.run(host='0.0.0.0', port=5000, threaded=True)

monitoring_thread = threading.Thread(target = renew)
monitoring_thread.start()  
thread = threading.Thread(target=run_server)
thread.start()   