FROM python:3.12-slim
WORKDIR /opt/app-root/src

# OpenCV (including the regular wheel pulled in by rapidocr) needs X11/XCB libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxcb1 \
    libxcb-shape0 \
    libxcb-xfixes0 \
    libxcb-render0 \
    libxcb-shm0 \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution.
RUN pip install --no-cache-dir uv

# Pin to the same versions as the working venv on dev01.
RUN uv pip install --system --no-cache-dir \
    opencv-python-headless \
    docling==2.96.0 \
    docling-serve==1.20.0 \
    rapidocr==3.8.1

EXPOSE 5001
CMD ["docling-serve", "run", "--host", "0.0.0.0", "--port", "5001"]
