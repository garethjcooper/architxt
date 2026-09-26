FROM python:3.12-slim

WORKDIR /opt/app-root/src

# Install system libraries required by OpenCV and Docling image processing.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1-mesa-glx \
    libsm6 \
    libxext6 \
    libxrender1 \
    libxcb1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution.
RUN pip install --no-cache-dir uv

# Pin to the same versions as the working venv on dev01.
RUN uv pip install --system --no-cache-dir \
    docling==2.96.0 \
    docling-serve==1.20.0 \
    rapidocr_onnxruntime

EXPOSE 5001

CMD ["docling-serve", "run", "--host", "0.0.0.0", "--port", "5001"]
