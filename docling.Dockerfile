FROM python:3.12-slim

WORKDIR /opt/app-root/src

# Pin docling-serve and let it pull in the compatible docling version.
# Gradio is required for the docling-serve UI.
RUN pip install --no-cache-dir docling-serve==1.33.0 gradio

EXPOSE 5001

CMD ["python", "-m", "docling_serve", "run", "--enable-ui"]
