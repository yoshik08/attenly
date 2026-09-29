import base64
import io
import json

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI
from PIL import Image
from pydantic import BaseModel

META = json.load(open("model/crnn.json"))
ALPHA = META["alphabet"]
W, H = META["img_w"], META["img_h"]

sess = ort.InferenceSession("model/crnn.onnx", providers=["CPUExecutionProvider"])

app = FastAPI()


class SolveReq(BaseModel):
    image_b64: str


def solve_captcha(b64: str) -> str:
    raw = base64.b64decode(b64)
    im = Image.open(io.BytesIO(raw)).convert("RGBA").resize((W, H))
    arr = np.array(im, dtype=np.float32)[:, :, 3] / 255.0  # alpha channel
    x = arr[None, None, :, :].astype(np.float32)
    logits = sess.run(["logits"], {"input": x})[0][0]
    out, last = [], -1
    for t in range(logits.shape[0]):
        best = int(np.argmax(logits[t]))
        if best != last and best != 0:
            out.append(ALPHA[best - 1])
        last = best
    return "".join(out)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/solve")
def solve(req: SolveReq):
    return {"text": solve_captcha(req.image_b64)}
