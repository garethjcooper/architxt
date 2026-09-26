FROM python:3.12-slim

WORKDIR /opt/app-root/src

# Install uv for fast dependency resolution.
RUN pip install --no-cache-dir uv

# Pin to the same versions as the working venv on dev01.
RUN uv pip install --system --no-cache-dir \
    docling==2.96.0 \
    docling-serve==1.20.0 \
    rapidocr_onnxruntime

EXPOSE 5001

CMD ["docling-serve", "run", "--host", "0.0.0.0", "--port", "5001"]
