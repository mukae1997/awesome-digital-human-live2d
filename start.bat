set http_proxy=http://127.0.0.1:7890
set https_proxy=http://127.0.0.1:7890
start python main.py
cd web
set http_proxy=http://127.0.0.1:7890
set https_proxy=http://127.0.0.1:7890
start npm run dev
cd ..
cd ..
cd button
start python button.py
