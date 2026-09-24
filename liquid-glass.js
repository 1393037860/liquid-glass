(function () {
  const root = document.documentElement;
  const liquidCanvases = document.querySelectorAll(".liquid-glass-canvas");
  if (!liquidCanvases.length) return;

  const vertexSource = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 fragTexCoord;

    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      fragTexCoord = a_texCoord;
    }
  `;

  const fragmentSource = `
    precision highp float;

    #define PI 3.141592653589793
    #define Pow 3.0
    #define A 1.75
    #define B 1.25
    #define C 2.0
    #define GRAD 255.0

    varying vec2 fragTexCoord;

    uniform sampler2D backgroundTexture;
    uniform sampler2D orbTexture;
    uniform sampler2D lineTexture;
    uniform vec2 resolution;
    uniform vec2 backgroundResolution;
    uniform vec2 textureOffset;
    uniform vec2 lightPos;
    uniform float glassBlur;
    // 折射带宽度(设备像素)= glassBlur × data-glass-lens,比高光带略宽即可
    uniform float refractionBlur;
    // 色散强度(设备像素):越大,R/B 通道被拉得越开,文字细笔画越容易被冲淡
    uniform float dispersion;
    // 内部边缘光晕强度倍率(0=最接近原色,1=原版)。data-glass-glow,默认 0.5
    uniform float glowScale;
    // 折射位移幅度倍率(相对 glassBlur)。data-glass-refract,默认 0.6
    // 越小 → 画面尺寸越接近原样(边缘"压扁"越少),折射感也越弱
    uniform float refractScale;
    uniform float cornerRadius;
    uniform vec2 shapeSize;
    uniform float alphaBoost;
    uniform float darkAmount;
    uniform vec2 viewportOffset;
    uniform float lineFieldOpacity;

    float dither(vec2 pixelCoord) {
      int x = int(mod(pixelCoord.x, 8.0));
      int y = int(mod(pixelCoord.y, 8.0));
      int idx = x * 8 + y;
      if (idx == 0) return 0.0;
      if (idx == 1) return 0.5;
      if (idx == 2) return 0.125;
      if (idx == 3) return 0.625;
      if (idx == 4) return 0.03125;
      if (idx == 5) return 0.53125;
      if (idx == 6) return 0.15625;
      if (idx == 7) return 0.65625;
      if (idx == 8) return 0.75;
      if (idx == 9) return 0.25;
      if (idx == 10) return 0.875;
      if (idx == 11) return 0.375;
      if (idx == 12) return 0.78125;
      if (idx == 13) return 0.28125;
      if (idx == 14) return 0.90625;
      if (idx == 15) return 0.40625;
      if (idx == 16) return 0.1875;
      if (idx == 17) return 0.6875;
      if (idx == 18) return 0.0625;
      if (idx == 19) return 0.5625;
      if (idx == 20) return 0.21875;
      if (idx == 21) return 0.71875;
      if (idx == 22) return 0.09375;
      if (idx == 23) return 0.59375;
      if (idx == 24) return 0.9375;
      if (idx == 25) return 0.4375;
      if (idx == 26) return 0.8125;
      if (idx == 27) return 0.3125;
      if (idx == 28) return 0.96875;
      if (idx == 29) return 0.46875;
      if (idx == 30) return 0.84375;
      if (idx == 31) return 0.34375;
      if (idx == 32) return 0.046875;
      if (idx == 33) return 0.546875;
      if (idx == 34) return 0.171875;
      if (idx == 35) return 0.671875;
      if (idx == 36) return 0.015625;
      if (idx == 37) return 0.515625;
      if (idx == 38) return 0.140625;
      if (idx == 39) return 0.640625;
      if (idx == 40) return 0.796875;
      if (idx == 41) return 0.296875;
      if (idx == 42) return 0.921875;
      if (idx == 43) return 0.421875;
      if (idx == 44) return 0.765625;
      if (idx == 45) return 0.265625;
      if (idx == 46) return 0.890625;
      if (idx == 47) return 0.390625;
      if (idx == 48) return 0.234375;
      if (idx == 49) return 0.734375;
      if (idx == 50) return 0.109375;
      if (idx == 51) return 0.609375;
      if (idx == 52) return 0.203125;
      if (idx == 53) return 0.703125;
      if (idx == 54) return 0.078125;
      if (idx == 55) return 0.578125;
      if (idx == 56) return 0.984375;
      if (idx == 57) return 0.484375;
      if (idx == 58) return 0.859375;
      if (idx == 59) return 0.359375;
      if (idx == 60) return 0.953125;
      if (idx == 61) return 0.453125;
      if (idx == 62) return 0.828125;
      return 0.328125;
    }

    float sdRoundBox(vec2 p, vec2 halfSize, float radius) {
      vec2 q = abs(p) - halfSize + vec2(radius);
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    float distance_pow(vec2 p, float pw) {
      return pow(pow(abs(p.x), pw) + pow(abs(p.y), pw), 1.0 / pw);
    }

    vec2 capsuleAnchor(vec2 p, vec2 halfSize, float radius) {
      float capX = max(halfSize.x - radius, 0.0);
      return vec2(clamp(p.x, -capX, capX), 0.0);
    }

    vec2 sdfNormal(vec2 p, vec2 halfSize, float radius) {
      vec2 e = vec2(1.0, 0.0);
      vec2 n = vec2(
        sdRoundBox(p + e.xy, halfSize, radius) - sdRoundBox(p - e.xy, halfSize, radius),
        sdRoundBox(p + e.yx, halfSize, radius) - sdRoundBox(p - e.yx, halfSize, radius)
      );
      float lenN = length(n);
      if (lenN < 0.0001) {
        vec2 fallback = capsuleAnchor(p, halfSize, radius);
        n = p - fallback;
        lenN = length(n);
      }
      if (lenN < 0.0001) return vec2(0.0, -1.0);
      return n / lenN;
    }

    float liquidRel(float dst, float glassRadius, float blurRadius) {
      float normalized = pow(clamp(max(0.0, dst - glassRadius + blurRadius) / blurRadius, 0.0, 1.0), A);
      return 1.0 - pow(1.0 - pow(1.0 - normalized, B), C);
    }
    vec2 toTex(vec2 pixelCoord) {
      vec2 uv = vec2(
        (pixelCoord.x + textureOffset.x) / backgroundResolution.x,
        (pixelCoord.y + textureOffset.y) / backgroundResolution.y
      );
      return clamp(uv, vec2(0.001), vec2(0.999));
    }

    vec3 applyOrbs(vec3 base, vec2 pixelCoord) {
      vec2 uv = (pixelCoord + viewportOffset) / backgroundResolution;
      vec4 orb = texture2D(orbTexture, clamp(uv, vec2(0.001), vec2(0.999)));
      return mix(base, orb.rgb, orb.a);
    }

    vec3 applyLineField(vec3 base, vec2 pixelCoord) {
      if (lineFieldOpacity <= 0.001) return base;
      vec2 uv = (pixelCoord + viewportOffset) / backgroundResolution;
      vec4 line = texture2D(lineTexture, clamp(uv, vec2(0.001), vec2(0.999)));
      return mix(base, line.rgb, line.a * lineFieldOpacity);
    }

    void main() {
      vec2 pixelCoord = vec2(fragTexCoord.x * resolution.x, (1.0 - fragTexCoord.y) * resolution.y);
      float ditherValue = dither(pixelCoord);
      vec2 center = resolution * 0.5;
      vec2 p = pixelCoord - center;
      vec2 halfSize = max(shapeSize * 0.5 - vec2(0.75), vec2(1.0));
      float radius = min(cornerRadius, min(halfSize.x, halfSize.y));
      float signedDistance = sdRoundBox(p, halfSize, radius);
      float visibleMask = 1.0 - smoothstep(0.25, 1.0, signedDistance);
      if (visibleMask <= 0.001) {
        discard;
      }

      vec2 normal = sdfNormal(p, halfSize, radius);
      float glassRadius = radius;
      float distance = clamp(glassRadius + signedDistance, 0.0, glassRadius + 6.25);
      // 折射带比高光带略宽(原版的折射剖面是"厚镜片"型:circleMap 在带中间
      // 最强、内侧回到 0)。宽度由 data-glass-lens 控制,默认 1.25。
      // 位移的**幅度**单独可控(data-glass-refract,默认 0.6):
      //   每个像素都从边缘往内侧取样(顶边向下、底边向上)→ 上下内容被压向中间,
      //   看起来"变小/被压扁"。幅度 = max(glassBlur × refract, 4) 设备像素,
      //   调小即可让画面尺寸更接近原样,而不必削弱折射带宽度。
      vec2 refraction =
        normal * min(distance, max(glassBlur * refractScale, 4.0));
      // 色散只在四角最强、在水平/垂直中线上归零(借鉴原版 (cx*cy)/(hx*hy)),
      // 这样上下边缘不会再出现横贯整条的彩虹纹。
      float chromaWeight =
        abs((p.x * p.y) / max(1.0, halfSize.x * halfSize.y));
      float chromaDispersion = dispersion * chromaWeight;
      vec2 d = normal * distance;

      vec3 back = applyLineField(applyOrbs(texture2D(backgroundTexture, toTex(pixelCoord)).rgb, pixelCoord), pixelCoord);
      vec3 color = back;
      vec2 lightVec = pixelCoord - lightPos;
      float dt = clamp((abs(lightVec.x) + abs(lightVec.y)) / glassBlur, 0.0, 1.0);
      float rel = 0.0;
      float r = 0.0;
      float g = 0.0;
      float b = 0.0;

      if (signedDistance <= 0.0) {
        rel = liquidRel(distance, glassRadius, refractionBlur);
        float ref = rel;
        int upsc = int(clamp(floor(12.0 * abs(1.0 - ref) + ditherValue), 1.0, 8.0));

        if (upsc < 2) {
          float dsp = min(1.0, chromaDispersion / glassRadius * (1.0 - ref));
          vec2 r_coord = pixelCoord - refraction * (1.0 - ref + dsp);
          vec2 g_coord = pixelCoord - refraction * (1.0 - ref);
          vec2 b_coord = pixelCoord - refraction * (1.0 - ref - dsp);
          r += applyLineField(texture2D(backgroundTexture, toTex(r_coord)).rgb, r_coord).r;
          g += applyLineField(texture2D(backgroundTexture, toTex(g_coord)).rgb, g_coord).g;
          b += applyLineField(texture2D(backgroundTexture, toTex(b_coord)).rgb, b_coord).b;
        } else {
          float dst;
          float dsp;

          dst = clamp(glassRadius + sdRoundBox(p + vec2(-0.5, -0.5), halfSize, radius), 0.0, glassRadius + 6.25);
          float ref_g0 = liquidRel(dst, glassRadius, refractionBlur);
          dsp = min(1.0, chromaDispersion / glassRadius * (1.0 - ref_g0));
          float ref_r0 = ref_g0 - dsp;
          float ref_b0 = ref_g0 + dsp;

          dst = clamp(glassRadius + sdRoundBox(p + vec2(0.5, -0.5), halfSize, radius), 0.0, glassRadius + 6.25);
          float ref_g1 = liquidRel(dst, glassRadius, refractionBlur);
          dsp = min(1.0, chromaDispersion / glassRadius * (1.0 - ref_g1));
          float ref_r1 = ref_g1 - dsp;
          float ref_b1 = ref_g1 + dsp;

          dst = clamp(glassRadius + sdRoundBox(p + vec2(-0.5, 0.5), halfSize, radius), 0.0, glassRadius + 6.25);
          float ref_g2 = liquidRel(dst, glassRadius, refractionBlur);
          dsp = min(1.0, chromaDispersion / glassRadius * (1.0 - ref_g2));
          float ref_r2 = ref_g2 - dsp;
          float ref_b2 = ref_g2 + dsp;

          dst = clamp(glassRadius + sdRoundBox(p + vec2(0.5, 0.5), halfSize, radius), 0.0, glassRadius + 6.25);
          float ref_g3 = liquidRel(dst, glassRadius, refractionBlur);
          dsp = min(1.0, chromaDispersion / glassRadius * (1.0 - ref_g3));
          float ref_r3 = ref_g3 - dsp;
          float ref_b3 = ref_g3 + dsp;

          for (int ii = 0; ii < 8; ii++) {
            if (ii >= upsc) break;
            for (int jj = 0; jj < 8; jj++) {
              if (jj >= upsc) break;
              float inum = float(ii) / float(upsc);
              float jnum = float(jj) / float(upsc);
              float rr = ref_r0 + (ref_r1 - ref_r0) * inum + (ref_r2 - ref_r0) * jnum + (ref_r3 - ref_r0) * inum * jnum;
              float gg = ref_g0 + (ref_g1 - ref_g0) * inum + (ref_g2 - ref_g0) * jnum + (ref_g3 - ref_g0) * inum * jnum;
              float bb = ref_b0 + (ref_b1 - ref_b0) * inum + (ref_b2 - ref_b0) * jnum + (ref_b3 - ref_b0) * inum * jnum;
              vec2 r_coord = pixelCoord - refraction * (1.0 - rr);
              vec2 g_coord = pixelCoord - refraction * (1.0 - gg);
              vec2 b_coord = pixelCoord - refraction * (1.0 - bb);
              r += applyLineField(texture2D(backgroundTexture, toTex(r_coord)).rgb, r_coord).r;
              g += applyLineField(texture2D(backgroundTexture, toTex(g_coord)).rgb, g_coord).g;
              b += applyLineField(texture2D(backgroundTexture, toTex(b_coord)).rgb, b_coord).b;
            }
          }

          float div = float(upsc * upsc);
          r /= div;
          g /= div;
          b /= div;
        }

        if (rel < 0.15) {
          float shad = 0.85 + rel;
          r *= shad;
          g *= shad;
          b *= shad;
        }

        float num1 = clamp(distance - glassRadius + 2.25, 0.0, 1.0) * dt;
        float num2 = (1.0 - rel * pow(1.0 - rel, 2.0)) * pow(1.0 - (glassRadius - distance) / glassBlur, 2.2) * dt;
        float ang1 = 0.0;
        float ang2 = 0.0;
        if (num1 > 0.0 || num2 > 0.0) {
          vec2 lightDir = lightPos - pixelCoord;
          float angle = atan(d.y, d.x) - atan(lightDir.y, lightDir.x);
          ang1 = cos(angle);
          ang2 = cos(angle - PI);
        }
        if (num1 > 0.0) {
          float high = num1 * max(0.16, ang1);
          r *= 1.0 - high;
          g *= 1.0 - high;
          b *= 1.0 - high;
          r += (1.0 - r) * high;
          g += (1.0 - g) * high;
          b += (1.0 - b) * high;
        }
        if (num2 > 0.0) {
          // 内部边缘光晕(原版的签名提亮)。它的作用范围是"整个内部"而不是薄薄一圈,
          // 实测会把图片上的选中蓝 #3264ce 抬到 #789ade(约 24~34% 向白偏移)。
          // 强度由 data-glass-glow 控制:1 = 原版,0 = 最接近原色。
          float high =
            num2 * pow(max(0.0, max(ang2 * 0.4, ang1 * 0.3)), 2.2) * glowScale;
          r += (1.0 - r) * high;
          g += (1.0 - g) * high;
          b += (1.0 - b) * high;
        }

        color = applyOrbs(vec3(r, g, b), pixelCoord - refraction * (1.0 - rel));
      }

      if (distance > glassRadius - 2.0 && signedDistance <= 0.75) {
        float shad = (distance - glassRadius) / 6.25;
        shad = clamp(shad, 0.0, 1.0);
        vec2 lightVec2 = pixelCoord - lightPos;
        float glassAngle = atan(d.y, d.x);
        float lightAngle = atan(lightVec2.y, lightVec2.x);
        float angle = glassAngle - lightAngle;
        shad = 1.0 - (1.0 - shad) * max(0.16, cos(angle)) * dt;
        shad = pow(shad, 1.0 / 2.2) * 0.5 + 0.5;
        float alp = clamp(glassRadius - distance, 0.0, 1.0);
        back *= shad;
        color = mix(back, color, alp);
      }

      color = floor(clamp(color, 0.0, 1.0) * GRAD + ditherValue) / GRAD;

      float alpha = visibleMask * alphaBoost;
      gl_FragColor = vec4(color, alpha);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(
        gl.getShaderInfoLog(shader) || "LiquidGlass shader compile failed",
      );
    }
    return shader;
  }

  function link(gl, vertex, fragment) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        gl.getProgramInfoLog(program) || "LiquidGlass program link failed",
      );
    }
    return program;
  }

  function createBackgroundCanvas() {
    const bg = document.createElement("canvas");
    const ctx = bg.getContext("2d", { alpha: false });
    return {
      bg,
      ctx,
      width: 0,
      height: 0,
      scrollY: -1,
      gridX: NaN,
      gridY: NaN,
      gridOpacity: NaN,
      diagonalOpacity: NaN,
      bgColor: "",
      dotColor: "",
      skipUnsafeImages: false,
      warnedTaintedCanvas: false,
      textureUploaded: false,
    };
  }

  function intersects(a, b) {
    return (
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );
  }

  function getCompositedOpacity(element) {
    let opacity = 1;
    let current = element;

    while (
      current &&
      current.nodeType === 1 &&
      current !== document.body.parentElement
    ) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      const value = parseFloat(style.opacity);
      if (Number.isFinite(value)) opacity *= value;
      current = current.parentElement;
    }

    return opacity;
  }

  function drawBlurredCircle(ctx, x, y, radius, color, blur) {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function canvasFontFromStyle(style, dpr) {
    const fontSize = (parseFloat(style.fontSize) || 16) * dpr;
    return `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  }

  function applyCanvasTextSpacing(ctx, style, dpr) {
    if ("letterSpacing" in ctx) {
      const letterSpacing =
        style.letterSpacing === "normal"
          ? 0
          : parseFloat(style.letterSpacing) || 0;
      ctx.letterSpacing = `${letterSpacing * dpr}px`;
    }

    if ("wordSpacing" in ctx) {
      const wordSpacing =
        style.wordSpacing === "normal" ? 0 : parseFloat(style.wordSpacing) || 0;
      ctx.wordSpacing = `${wordSpacing * dpr}px`;
    }
  }

  function colorMixAlpha(color, alpha) {
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw =
        hex[1].length === 3
          ? hex[1]
              .split("")
              .map((item) => item + item)
              .join("")
          : hex[1];
      const value = parseInt(raw, 16);
      return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
    }

    const rgb = color.match(/rgba?\(([^)]+)\)/i);
    if (rgb) {
      const parts = rgb[1].split(",").map((part) => parseFloat(part));
      return `rgba(${parts[0] || 0}, ${parts[1] || 0}, ${parts[2] || 0}, ${alpha})`;
    }

    return `rgba(7, 7, 7, ${alpha})`;
  }

  function radialGridMask(t) {
    if (t <= 0.23) return 1;
    if (t <= 0.47) return 1 - ((t - 0.23) / 0.24) * 0.24;
    if (t <= 0.82) return 0.76 * (1 - (t - 0.47) / 0.35);
    return 0;
  }

  function drawProductDiagonalTexture(
    ctx,
    canvasRect,
    dpr,
    fgColor,
    gridX,
    gridY,
    opacity,
  ) {
    if (opacity <= 0.001) return;

    const section = document.querySelector(".product-section");
    if (!section) return;

    const rect = section.getBoundingClientRect();
    const top = rect.top - window.innerHeight * 0.38;
    const bottom = rect.bottom;
    if (bottom < canvasRect.top || top > canvasRect.bottom) return;

    const x = (rect.left - canvasRect.left) * dpr;
    const y = (top - canvasRect.top) * dpr;
    const width = rect.width * dpr;
    const height = (bottom - top) * dpr;
    const isDark = root.dataset.theme === "dark";

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const angle = (55 * Math.PI) / 180;
    const lineX = Math.cos(angle);
    const lineY = Math.sin(angle);
    const normalX = Math.sin(angle);
    const normalY = -Math.cos(angle);
    const drawLines = (period, stripeCenter, alpha, lineWidth, phaseScale) => {
      const posX = gridX * phaseScale * dpr;
      const posY = gridY * phaseScale * dpr;
      const corners = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height],
      ];
      let minP = Infinity;
      let maxP = -Infinity;

      corners.forEach(([cx, cy]) => {
        const projection = (cx - posX) * normalX + (cy - posY) * normalY;
        minP = Math.min(minP, projection);
        maxP = Math.max(maxP, projection);
      });

      ctx.strokeStyle = colorMixAlpha(fgColor, alpha);
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const lineLength = Math.hypot(width, height) + period * 4;
      const first =
        Math.floor((minP - stripeCenter) / period) * period + stripeCenter;
      for (let p = first; p <= maxP + period; p += period) {
        const baseX = x + posX + normalX * p;
        const baseY = y + posY + normalY * p;
        ctx.moveTo(baseX - lineX * lineLength, baseY - lineY * lineLength);
        ctx.lineTo(baseX + lineX * lineLength, baseY + lineY * lineLength);
      }
      ctx.stroke();
    };

    drawLines(
      29 * dpr,
      14.5 * dpr,
      isDark ? 0.028 : 0.052,
      Math.max(0.75, 1 * dpr),
      1,
    );
    drawLines(
      76 * dpr,
      37.5 * dpr,
      isDark ? 0.018 : 0.026,
      Math.max(0.6, 0.75 * dpr),
      0.6,
    );
    ctx.restore();
  }

  function drawRefractionField(
    ctx,
    canvasRect,
    dpr,
    fgColor,
    gridX,
    gridY,
    opacity,
  ) {
    if (opacity <= 0.001) return;

    const time = performance.now() * 0.00011;
    const phase = [
      Math.sin(time),
      Math.sin(time * 1.18 + 1.7),
      Math.cos(time * 1.05 + 0.8),
    ];

    // 柔和单色光散射 — 模拟玻璃表面的自然光线变化
    const blobs = [
      {
        x: 0.15,
        y: 0.15,
        r: 0.32,
        dx: 0.22,
        dy: 0.14,
        color: "rgba(255, 255, 255, 0.06)",
        phase: phase[0],
      },
      {
        x: 0.82,
        y: 0.22,
        r: 0.28,
        dx: -0.18,
        dy: 0.16,
        color: "rgba(255, 255, 255, 0.05)",
        phase: phase[1],
      },
      {
        x: 0.48,
        y: 0.55,
        r: 0.36,
        dx: 0.14,
        dy: -0.12,
        color: "rgba(200, 200, 210, 0.04)",
        phase: phase[2],
      },
    ];

    ctx.save();
    ctx.globalAlpha = opacity;

    blobs.forEach((blob, index) => {
      const viewportX =
        (window.innerWidth * (blob.x + blob.dx * blob.phase) +
          gridX * (0.12 - index * 0.025)) *
        dpr;
      const viewportY =
        (window.innerHeight * (blob.y + blob.dy * blob.phase) +
          gridY * (0.1 - index * 0.018)) *
        dpr;
      const radius =
        Math.min(window.innerWidth, window.innerHeight) * blob.r * dpr;
      drawBlurredCircle(
        ctx,
        viewportX - canvasRect.left * dpr,
        viewportY - canvasRect.top * dpr,
        radius,
        blob.color,
        Math.max(90, radius * 0.58),
      );
    });
    ctx.restore();
  }

  function getLineHeight(style, fontSize) {
    const parsed = parseFloat(style.lineHeight);
    return Number.isFinite(parsed) ? parsed : fontSize * 1.25;
  }

  // 中日韩文字在两字之间就可以断行,西文必须按单词断行。
  // 之前只看「有没有空格」:像 "RGB 三通道以不同偏移量…" 这种中西混排,
  // 因为有空格就整体按单词切分,整段中文变成了一个不可断行的单元,
  // 于是换行位置错、超宽的一行还会被 fillText 的 maxWidth 横向压扁。
  const CJK_CHAR_PATTERN =
    /[\u1100-\u11FF\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/;

  function splitWrapUnits(text) {
    const units = [];
    let word = "";

    const flushWord = () => {
      if (word) {
        units.push(word);
        word = "";
      }
    };

    // Array.from 保证代理对(emoji 等)不会被拆成两半
    Array.from(text).forEach((char) => {
      if (/\s/.test(char)) {
        flushWord();
        units.push(char);
      } else if (CJK_CHAR_PATTERN.test(char)) {
        flushWord();
        units.push(char);
      } else {
        word += char;
      }
    });
    flushWord();

    return units;
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const units = splitWrapUnits(text);
    const lines = [];
    let line = "";

    const pushLine = (value) => {
      const clean = value.replace(/\s+$/, "");
      if (clean) lines.push(clean);
    };

    units.forEach((unit) => {
      const next = line ? line + unit : unit;
      if (line && ctx.measureText(next).width > maxWidth) {
        pushLine(line);
        line = unit.replace(/^\s+/, "");
      } else {
        line = next;
      }

      // 单个单元本身就超宽(超长英文单词、URL 等):按字符硬断,
      // 否则这一行会被 fillText 的 maxWidth 参数压缩变形。
      while (line.length > 1 && ctx.measureText(line).width > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) {
          cut -= 1;
        }
        pushLine(line.slice(0, cut));
        line = line.slice(cut);
      }
    });

    if (line.trim()) lines.push(line.trim());
    return lines.length ? lines : [text];
  }

  function collectTextNodes(element) {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.nodeValue && node.nodeValue.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function drawTextByRangeRects(
    ctx,
    element,
    canvasRect,
    dpr,
    style,
    options = {},
  ) {
    const fullText = element.textContent || "";
    if (!fullText.trim() || fullText.length > 520) return false;

    const textNodes = collectTextNodes(element);
    if (!textNodes.length) return false;

    const fontSize = parseFloat(style.fontSize) || 16;
    let drew = false;

    ctx.save();
    ctx.font = canvasFontFromStyle(style, dpr);
    ctx.fillStyle = options.color || style.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    applyCanvasTextSpacing(ctx, style, dpr);
    ctx.globalAlpha = getCompositedOpacity(element) * (options.opacity ?? 1);

    textNodes.forEach((textNode) => {
      const raw = textNode.nodeValue || "";
      let lineText = "";
      let lineTop = null;
      let lineBottom = null;
      let lineLeft = Infinity;
      let lineRight = -Infinity;

      const flushLine = () => {
        const clean = lineText.replace(/\s+/g, " ").trim();
        if (
          !clean ||
          lineTop === null ||
          !Number.isFinite(lineLeft) ||
          !Number.isFinite(lineRight)
        ) {
          lineText = "";
          lineTop = null;
          lineBottom = null;
          lineLeft = Infinity;
          lineRight = -Infinity;
          return;
        }

        const x = (lineLeft - canvasRect.left) * dpr;
        const y = ((lineTop + lineBottom) * 0.5 - canvasRect.top) * dpr;
        const maxWidth = Math.max(
          fontSize * dpr,
          (lineRight - lineLeft) * dpr * 1.08,
        );
        ctx.fillText(clean, x, y, maxWidth);
        drew = true;

        lineText = "";
        lineTop = null;
        lineBottom = null;
        lineLeft = Infinity;
        lineRight = -Infinity;
      };

      for (let index = 0; index < raw.length; index += 1) {
        const char = raw[index];
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = range.getBoundingClientRect();
        range.detach?.();

        if (!rect.width && !rect.height) {
          if (lineText && /\s/.test(char)) lineText += " ";
          continue;
        }

        if (
          lineTop !== null &&
          Math.abs(rect.top - lineTop) > Math.max(2, fontSize * 0.32)
        ) {
          flushLine();
        }

        lineText += char;
        lineTop = lineTop === null ? rect.top : Math.min(lineTop, rect.top);
        lineBottom =
          lineBottom === null ? rect.bottom : Math.max(lineBottom, rect.bottom);
        lineLeft = Math.min(lineLeft, rect.left);
        lineRight = Math.max(lineRight, rect.right);
      }

      flushLine();
    });

    ctx.restore();
    return drew;
  }

  function isCompositeTextElement(element) {
    return Boolean(
      element.matches?.(
        ".abacus .price, .pdaim-license-price, .badge-money, .item-stock, .pdaim-license-tag, .sku, .chip, .switch-category",
      ),
    );
  }

  function drawTextElement(ctx, element, canvasRect, dpr, options = {}) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;

    const text = (options.text || element.textContent)
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;

    const style = getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize) || 16;
    const lineHeight = getLineHeight(style, fontSize);
    const x =
      ((options.x ?? rect.left + rect.width / 2) - canvasRect.left) * dpr;
    const y =
      ((options.y ?? rect.top + rect.height / 2) - canvasRect.top) * dpr;
    const maxWidth = (options.maxWidth ?? rect.width * 1.08) * dpr;
    const isMultiline =
      !options.text && text.length > 18 && rect.height > lineHeight * 1.45;

    // 折行文本优先走逐字测量(Range)的真实排版:浏览器怎么断行、每行多宽,
    // 就照着画,不会出现换行位置不同、行被 maxWidth 压扁的问题。
    // 手动换行只作为兜底(文本过长或取不到文本节点时)。
    if (
      (options.precise || isMultiline || isCompositeTextElement(element)) &&
      !options.text &&
      drawTextByRangeRects(ctx, element, canvasRect, dpr, style, options)
    ) {
      return;
    }

    ctx.save();
    ctx.font = canvasFontFromStyle(style, dpr);
    ctx.fillStyle = options.color || style.color;
    applyCanvasTextSpacing(ctx, style, dpr);
    ctx.globalAlpha = getCompositedOpacity(element) * (options.opacity ?? 1);

    if (isMultiline) {
      const paddingLeft = parseCssLength(style.paddingLeft, 0);
      const paddingRight = parseCssLength(style.paddingRight, 0);
      const paddingTop = parseCssLength(style.paddingTop, 0);
      const align = style.textAlign === "start" ? "left" : style.textAlign;
      const innerWidth =
        Math.max(fontSize * 2, rect.width - paddingLeft - paddingRight) * dpr;
      const lines = wrapCanvasText(ctx, text, innerWidth);
      const drawX =
        align === "right"
          ? (rect.right - paddingRight - canvasRect.left) * dpr
          : align === "center"
            ? (rect.left + rect.width * 0.5 - canvasRect.left) * dpr
            : (rect.left + paddingLeft - canvasRect.left) * dpr;
      let drawY =
        (rect.top + paddingTop + lineHeight * 0.5 - canvasRect.top) * dpr;
      const maxLines = Math.max(
        1,
        Math.floor((rect.height - paddingTop) / Math.max(lineHeight, 1)),
      );

      ctx.textAlign = align === "right" || align === "center" ? align : "left";
      ctx.textBaseline = "middle";
      lines.slice(0, maxLines).forEach((line) => {
        // 不传 maxWidth:换行已经按宽度算好,再传一次会让超宽的行被横向压扁
        ctx.fillText(line, drawX, drawY);
        drawY += lineHeight * dpr;
      });
    } else {
      const ta = style.textAlign === "start" ? "left" : style.textAlign;
      const paddingLeft = parseCssLength(style.paddingLeft, 0);
      const paddingRight = parseCssLength(style.paddingRight, 0);
      const textX =
        ta === "right" || ta === "end"
          ? (rect.right - paddingRight - canvasRect.left) * dpr
          : ta === "center"
            ? (rect.left + rect.width * 0.5 - canvasRect.left) * dpr
            : (rect.left + paddingLeft - canvasRect.left) * dpr;
      ctx.textAlign =
        ta === "right" || ta === "end"
          ? "right"
          : ta === "center"
            ? "center"
            : "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, textX, y, Math.max(maxWidth, fontSize * dpr));
    }
    ctx.restore();
  }

  function drawTextLikeElement(
    ctx,
    sourceElement,
    text,
    rect,
    canvasRect,
    dpr,
    options = {},
  ) {
    if (
      !sourceElement ||
      !rect.width ||
      !rect.height ||
      !intersects(rect, canvasRect)
    )
      return;

    const style = getComputedStyle(sourceElement);
    const fontSize = parseFloat(style.fontSize) || 16;
    const x =
      ((options.x ?? rect.left + rect.width / 2) - canvasRect.left) * dpr;
    const y =
      ((options.y ?? rect.top + rect.height / 2) - canvasRect.top) * dpr;
    const maxWidth = (options.maxWidth ?? rect.width * 1.08) * dpr;

    ctx.save();
    ctx.font = canvasFontFromStyle(style, dpr);
    ctx.fillStyle = options.color || style.color;
    ctx.textAlign = options.align || "center";
    ctx.textBaseline = options.baseline || "middle";
    applyCanvasTextSpacing(ctx, style, dpr);
    ctx.globalAlpha =
      getCompositedOpacity(sourceElement) * (options.opacity ?? 1);
    ctx.fillText(text, x, y, Math.max(maxWidth, fontSize * dpr));
    ctx.restore();
  }

  function drawImageFallback(ctx, image, canvasRect, dpr) {
    var rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;

    var rootStyle = getComputedStyle(root);
    var bg = rootStyle.getPropertyValue("--bg").trim() || "#ffffff";
    var x = (rect.left - canvasRect.left) * dpr;
    var y = (rect.top - canvasRect.top) * dpr;
    var w = rect.width * dpr;
    var h = rect.height * dpr;
    var r = Math.min(18 * dpr, w * 0.04, h * 0.08);
    var comp = getComputedStyle(image);
    var radius = parseCssLength(comp.borderTopLeftRadius, 0) * dpr || r;

    ctx.save();
    var opacity = parseFloat(comp.opacity);
    ctx.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
    roundedRectPath(ctx, x, y, w, h, radius);
    ctx.clip();

    // 简单渐变占位
    var grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, "#f0f0f5");
    grad.addColorStop(1, "#e8e8ef");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // 图片图标
    var cx = x + w * 0.5;
    var cy = y + h * 0.5;
    var iconR = Math.min(w, h) * 0.12;
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.beginPath();
    ctx.rect(cx - iconR, cy - iconR * 0.7, iconR * 2, iconR * 1.4);
    ctx.fill();
    ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
    ctx.beginPath();
    ctx.arc(cx - iconR * 0.3, cy - iconR * 0.3, iconR * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - iconR * 0.5, cy + iconR * 0.5);
    ctx.lineTo(cx, cy + iconR * 0.3);
    ctx.lineTo(cx + iconR * 0.5, cy + iconR * 0.5);
    ctx.lineTo(cx + iconR * 0.5, cy + iconR * 0.7);
    ctx.lineTo(cx + iconR * 0.25, cy + iconR * 0.55);
    ctx.lineTo(cx, cy + iconR * 0.7);
    ctx.lineTo(cx - iconR * 0.25, cy + iconR * 0.55);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawImageElement(
    ctx,
    image,
    canvasRect,
    dpr,
    skipUnsafeImages,
    alphaMultiplier,
  ) {
    if (skipUnsafeImages === undefined) skipUnsafeImages = false;
    var rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;

    // file:// 协议下 drawImage 会污染 canvas，导致 WebGL 纹理上传失败
    // 直接走简洁占位，避免反复重试。使用 HTTP 服务器可获得真实图片折射。
    if (
      window.location.protocol === "file:" ||
      skipUnsafeImages ||
      !image.complete
    ) {
      drawImageFallback(ctx, image, canvasRect, dpr);
      return;
    }

    ctx.save();
    ctx.globalAlpha =
      getCompositedOpacity(image) * (alphaMultiplier ?? 1);

    // 图片容器通常用 overflow:hidden + border-radius 裁圆角，
    // 图片自身没有圆角，需要按父容器裁剪，否则折射里会出现直角。
    var parent = image.parentElement;
    if (parent) {
      var ps = getComputedStyle(parent);
      var pOverflow = ps.overflow;
      var pRadius = parseCssLength(ps.borderTopLeftRadius, 0);
      if ((pOverflow === "hidden" || pOverflow === "clip") && pRadius > 0) {
        var prect = parent.getBoundingClientRect();
        if (prect.width && prect.height) {
          roundedRectPath(
            ctx,
            (prect.left - canvasRect.left) * dpr,
            (prect.top - canvasRect.top) * dpr,
            prect.width * dpr,
            prect.height * dpr,
            pRadius * dpr,
          );
          ctx.clip();
        }
      }
    }

    try {
      var comp = getComputedStyle(image);
      var objFit = comp.objectFit || "fill";
      var pl = parseCssLength(comp.paddingLeft, 0);
      var pr = parseCssLength(comp.paddingRight, 0);
      var pt = parseCssLength(comp.paddingTop, 0);
      var pb = parseCssLength(comp.paddingBottom, 0);
      var contentW = rect.width - pl - pr;
      var contentH = rect.height - pt - pb;
      var iw = image.naturalWidth || rect.width;
      var ih = image.naturalHeight || rect.height;

      if ((objFit === "contain" || objFit === "cover") && iw && ih) {
        var scaleX = contentW / iw;
        var scaleY = contentH / ih;
        var scale =
          objFit === "contain"
            ? Math.min(scaleX, scaleY)
            : Math.max(scaleX, scaleY);
        var dw = iw * scale;
        var dh = ih * scale;

        ctx.save();
        var ox = (rect.left + pl + (contentW - dw) / 2 - canvasRect.left) * dpr;
        var oy = (rect.top + pt + (contentH - dh) / 2 - canvasRect.top) * dpr;
        var clipX = (rect.left - canvasRect.left) * dpr;
        var clipY = (rect.top - canvasRect.top) * dpr;
        var clipW = rect.width * dpr;
        var clipH = rect.height * dpr;

        if (objFit === "cover") {
          roundedRectPath(
            ctx,
            clipX,
            clipY,
            clipW,
            clipH,
            parseCssLength(comp.borderTopLeftRadius, 0) * dpr || 0,
          );
          ctx.clip();
        }
        ctx.drawImage(image, ox, oy, dw * dpr, dh * dpr);
        ctx.restore();
      } else {
        ctx.drawImage(
          image,
          (rect.left - canvasRect.left) * dpr,
          (rect.top - canvasRect.top) * dpr,
          rect.width * dpr,
          rect.height * dpr,
        );
      }
    } catch (error) {
      ctx.restore();
      drawImageFallback(ctx, image, canvasRect, dpr);
      return;
    }
    ctx.restore();
  }

  function drawCanvasElement(ctx, sourceCanvas, canvasRect, dpr) {
    if (!sourceCanvas.width || !sourceCanvas.height) return;

    const rect = sourceCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;

    ctx.save();
    ctx.globalAlpha = getCompositedOpacity(sourceCanvas);
    try {
      ctx.drawImage(
        sourceCanvas,
        (rect.left - canvasRect.left) * dpr,
        (rect.top - canvasRect.top) * dpr,
        rect.width * dpr,
        rect.height * dpr,
      );
    } catch (error) {}
    ctx.restore();
  }

  function isTransparentColor(color) {
    return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function buildLinearGradient(ctx, bgImage, x, y, w, h) {
    var match = bgImage.match(/linear-gradient\(([^,]+),\s*(.+)\)/i);
    if (!match) return null;

    var angle = parseFloat(match[1]);
    if (isNaN(angle)) {
      if (/to\s+right/i.test(match[1])) angle = 90;
      else if (/to\s+top/i.test(match[1])) angle = 0;
      else if (/to\s+bottom/i.test(match[1])) angle = 180;
      else if (/to\s+left/i.test(match[1])) angle = 270;
      else angle = 90;
    }
    // CSS 0deg=上, canvas 0deg=右, 所以减90
    var rad = ((angle - 90) * Math.PI) / 180;

    // 用正则提取每个 rgb/rgba 色标，避免 split(",") 拆开 rgb 内部的逗号
    var stopStr = match[2];
    var stops = [];
    var colorRe = /rgba?\([^)]+\)/g;
    var cm;
    while ((cm = colorRe.exec(stopStr)) !== null) {
      stops.push(cm[0]);
    }
    if (stops.length < 2) return null;

    var hw = w * 0.5;
    var hh = h * 0.5;
    var halfDiag = Math.max(1, Math.hypot(hw, hh));
    var sx = x + hw - Math.cos(rad) * halfDiag;
    var sy = y + hh - Math.sin(rad) * halfDiag;
    var ex = x + hw + Math.cos(rad) * halfDiag;
    var ey = y + hh + Math.sin(rad) * halfDiag;

    try {
      var grad = ctx.createLinearGradient(sx, sy, ex, ey);
      stops.forEach(function (color, i) {
        grad.addColorStop(i / (stops.length - 1), color);
      });
      return grad;
    } catch (e) {
      return null;
    }
  }

  function drawElementBox(ctx, element, canvasRect, dpr) {
    var rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;

    var style = getComputedStyle(element);
    var background = style.backgroundColor;
    var borderColor = style.borderTopColor;
    var borderWidth = parseCssLength(style.borderTopWidth, 0);
    var radius = parseCssLength(style.borderTopLeftRadius, 0);
    var alpha = getCompositedOpacity(element);

    var hasBackground = !isTransparentColor(background);
    var hasGradient = false;
    if (!hasBackground) {
      var bgImage = style.backgroundImage;
      if (bgImage && bgImage !== "none" && /linear-gradient/i.test(bgImage)) {
        // 跳过 background-clip: text 的渐变（用于文字填充，不是盒子背景）
        var bgClip =
          style.backgroundClip ||
          style.getPropertyValue("-webkit-background-clip") ||
          "";
        if (!/text/.test(bgClip)) {
          hasGradient = true;
        }
      }
    }
    var hasBorder = borderWidth > 0 && !isTransparentColor(borderColor);
    if (hasBackground && background.includes("color-mix(")) return;
    if (!hasBackground && !hasGradient && !hasBorder) return;

    var x = (rect.left - canvasRect.left) * dpr;
    var y = (rect.top - canvasRect.top) * dpr;
    var w = rect.width * dpr;
    var h = rect.height * dpr;
    var r = radius * dpr;

    ctx.save();
    ctx.globalAlpha = alpha;
    roundedRectPath(ctx, x, y, w, h, r);
    if (hasBackground) {
      ctx.fillStyle = background;
      ctx.fill();
    } else if (hasGradient) {
      var grad = buildLinearGradient(ctx, bgImage, x, y, w, h);
      if (grad) {
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
    if (hasBorder) {
      ctx.lineWidth = Math.max(1, borderWidth * dpr);
      ctx.strokeStyle = borderColor;
      ctx.stroke();
    }
    ctx.restore();
  }

  function parseCssLength(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(Math.max(value, 0), 1);
  }

  function getCursorSnapshot() {
    const cursor = document.querySelector(".cursor-reveal");
    if (!cursor) return null;

    const style = getComputedStyle(cursor);
    const opacity = parseFloat(style.opacity);
    if (
      !Number.isFinite(opacity) ||
      opacity <= 0.01 ||
      style.display === "none" ||
      style.visibility === "hidden"
    ) {
      return null;
    }

    const rootStyle = getComputedStyle(root);
    const x = parseCssLength(
      style.getPropertyValue("--cursor-visual-x"),
      window.innerWidth * 0.5,
    );
    const y = parseCssLength(
      style.getPropertyValue("--cursor-visual-y"),
      window.innerHeight * 0.5,
    );
    const radius = parseCssLength(
      style.getPropertyValue("--cursor-active-radius"),
      0,
    );
    if (radius <= 0.5) return null;

    return {
      x,
      y,
      radius,
      edge: parseCssLength(style.getPropertyValue("--cursor-edge"), 5),
      opacity,
      color:
        rootStyle.getPropertyValue("--cursor").trim() || style.backgroundColor,
      textColor:
        rootStyle.getPropertyValue("--cursor-text").trim() || style.color,
    };
  }

  function drawCursorLayer(ctx, canvasRect, dpr) {
    const cursor = getCursorSnapshot();
    if (!cursor) return;

    const bounds = {
      left: cursor.x - cursor.radius,
      top: cursor.y - cursor.radius,
      right: cursor.x + cursor.radius,
      bottom: cursor.y + cursor.radius,
    };
    if (!intersects(bounds, canvasRect)) return;

    ctx.save();
    ctx.globalAlpha = cursor.opacity;
    const cx = (cursor.x - canvasRect.left) * dpr;
    const cy = (cursor.y - canvasRect.top) * dpr;
    const radius = cursor.radius * dpr;
    const edge = Math.max(1, cursor.edge * dpr);
    const gradient = ctx.createRadialGradient(
      cx,
      cy,
      Math.max(0, radius - edge),
      cx,
      cy,
      radius,
    );
    gradient.addColorStop(0, cursor.color);
    gradient.addColorStop(0.72, cursor.color);
    gradient.addColorStop(0.96, cursor.color);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    drawCursorRevealText(ctx, canvasRect, dpr, cursor);
    ctx.restore();
  }

  function drawCursorRevealText(ctx, canvasRect, dpr, cursor) {
    const revealCopy = document.querySelector(
      ".cursor-reveal .hero-copy-reveal",
    );
    const revealEyebrow = document.querySelector(
      ".cursor-reveal .hero-copy-reveal .eyebrow",
    );
    const revealStrong = document.querySelector(
      ".cursor-reveal .hero-copy-reveal .title-strong",
    );
    const revealComma = document.querySelector(
      ".cursor-reveal .hero-copy-reveal .title-comma",
    );
    const revealLight = document.querySelector(
      ".cursor-reveal .hero-copy-reveal .title-light",
    );
    const revealSubtitle = document.querySelector(
      ".cursor-reveal .hero-copy-reveal .subtitle",
    );

    if (!revealCopy || !revealStrong || !revealLight) return;

    const copyRect = revealCopy.getBoundingClientRect();
    const h2Rect = document
      .querySelector(".cursor-reveal .hero-copy-reveal h2")
      ?.getBoundingClientRect();
    const baseH1Rect = document
      .querySelector(".hero-copy-base h1")
      ?.getBoundingClientRect();
    const baseStrongRect = document
      .querySelector(".hero-copy-base .title-strong")
      ?.getBoundingClientRect();
    const baseLightRect = document
      .querySelector(".hero-copy-base .title-light")
      ?.getBoundingClientRect();

    // The browser cannot expose the final composited cursor layer to WebGL.
    // Repaint the reveal copy from the same screen-space anchors so the glass texture sees it.
    const sourceH1Rect = h2Rect || baseH1Rect;
    const titleY = sourceH1Rect
      ? sourceH1Rect.top + sourceH1Rect.height * 0.5
      : copyRect.top + copyRect.height * 0.5;

    if (baseStrongRect && baseLightRect) {
      drawTextLikeElement(
        ctx,
        revealStrong,
        "你好",
        baseStrongRect,
        canvasRect,
        dpr,
        {
          color: cursor.textColor,
          opacity: cursor.opacity,
          y: titleY,
        },
      );

      if (revealComma) {
        const commaRect = revealComma.getBoundingClientRect();
        const commaX = (baseStrongRect.right + baseLightRect.left) * 0.5;
        drawTextLikeElement(
          ctx,
          revealComma,
          "，",
          commaRect,
          canvasRect,
          dpr,
          {
            color: cursor.textColor,
            opacity: cursor.opacity,
            x: commaX,
            y: titleY,
            maxWidth: Math.max(32, baseLightRect.left - baseStrongRect.right),
          },
        );
      }

      drawTextLikeElement(
        ctx,
        revealLight,
        "这里是 PDAim",
        baseLightRect,
        canvasRect,
        dpr,
        {
          color: cursor.textColor,
          opacity: cursor.opacity,
          y: titleY,
        },
      );
    } else {
      [revealStrong, revealComma, revealLight]
        .filter(Boolean)
        .forEach((element) => {
          drawTextElement(ctx, element, canvasRect, dpr, {
            color: cursor.textColor,
            opacity: cursor.opacity,
          });
        });
    }

    if (revealEyebrow) {
      drawTextElement(ctx, revealEyebrow, canvasRect, dpr, {
        color: cursor.textColor,
        opacity: cursor.opacity * 0.72,
      });
    }

    if (revealSubtitle) {
      drawTextElement(ctx, revealSubtitle, canvasRect, dpr, {
        color: cursor.textColor,
        opacity: cursor.opacity * 0.72,
      });
    }
  }

  const EXCLUDE_ALL_GLASS_HOSTS = {};
  let underlyingCacheDirty = true;
  let underlyingElements = [];
  let underlyingImages = [];

  function getCaptureSelectors() {
    var capture = root.dataset.glassCapture;
    if (capture) {
      capture = capture.trim();
      if (capture === "all" || capture === "*")
        return { elements: "body *", images: "body img" };
      // 用户自定义选择器：如 ".my-container *, .another *"
      return {
        elements: capture + ", " + capture + " *",
        images: capture + " img",
      };
    }
    // 默认：采集页面所有可见内容（排除 glass 自身）
    return { elements: "body *", images: "body img" };
  }

  function refreshUnderlyingCache() {
    var selectors = getCaptureSelectors();
    underlyingElements = Array.from(
      document.querySelectorAll(selectors.elements),
    );
    underlyingImages = Array.from(document.querySelectorAll(selectors.images));
    underlyingCacheDirty = false;
  }

  function shouldSkipUnderlyingElement(element, host) {
    if (element.classList?.contains("liquid-glass-canvas")) {
      if (host === EXCLUDE_ALL_GLASS_HOSTS) return true;
      return Boolean(host && host.contains(element));
    }
    if (host?.dataset?.glassIsolate === "true") {
      if (element.closest?.(".pdaim-shop-panel")) return true;
      const elementRect = element.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      if (!intersects(elementRect, hostRect)) return true;
    }
    if (host === EXCLUDE_ALL_GLASS_HOSTS)
      return Boolean(element.closest?.("[data-liquid-glass]"));
    if (
      host?.closest?.(".site-header") &&
      !host.classList.contains("site-header")
    ) {
      return Boolean(host.contains(element));
    }
    return Boolean(host && host.contains(element));
  }

  function shouldDrawPreciseText(canvasRect) {
    return canvasRect.top < 180 && canvasRect.bottom > -40;
  }

  // ===== 文本选中态 =====
  // 原生选区不在 DOM 里,也不体现在计算样式里(Chrome 的 ::selection 默认值
  // 读到的是 transparent),它是合成器直接画的。所以必须自己还原两部分:
  //   底色 —— Range.getClientRects() 取几何,颜色优先取页面自定义的 ::selection,
  //           其次 --glass-selection-bg,最后系统高亮色(Highlight 系统色关键字)
  //   文字 —— 真实选中会把选中文字换成 HighlightText(通常是白字),
  //           这一步必须逐字重绘,否则玻璃里就是"蓝底深字",跟真实效果不一样
  let systemHighlightColors = null;

  function getSystemHighlightColors() {
    if (systemHighlightColors) return systemHighlightColors;

    let background = "";
    let text = "";
    try {
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;width:0;height:0;background-color:Highlight;color:HighlightText;";
      document.body.appendChild(probe);
      const probeStyle = getComputedStyle(probe);
      background = probeStyle.backgroundColor;
      text = probeStyle.color;
      probe.remove();
    } catch (error) {
      background = "";
      text = "";
    }

    systemHighlightColors = {
      background: isTransparentColor(background)
        ? "rgba(0, 120, 215, 0.85)"
        : background,
      text: isTransparentColor(text) ? "#ffffff" : text,
    };
    return systemHighlightColors;
  }

  // 允许用 CSS 变量覆盖成浏览器实际画的那个颜色
  // (不同平台 / 主题下 Chrome 画的选中色并不等于系统 Highlight 值)
  function getSelectionColorOverride(name) {
    try {
      return (
        getComputedStyle(root).getPropertyValue(name).trim() || ""
      );
    } catch (error) {
      return "";
    }
  }

  function resolveSelectionBackground(element, selectionStyle) {
    if (!isTransparentColor(selectionStyle.backgroundColor))
      return selectionStyle.backgroundColor;
    const override = getSelectionColorOverride("--glass-selection-bg");
    if (override) return override;
    return getSystemHighlightColors().background;
  }

  // Chrome 对 ::selection 的 color 默认值返回的是**正文颜色**(不是 HighlightText),
  // 所以不能只看"是否透明":只有作者确实覆盖过(与正文色不同)才采用它。
  function resolveSelectionTextColor(selectionStyle, normalColor) {
    const authored = selectionStyle.color;
    if (!isTransparentColor(authored) && authored !== normalColor)
      return authored;
    const override = getSelectionColorOverride("--glass-selection-fg");
    if (override) return override;
    return getSystemHighlightColors().text;
  }

  // 浏览器画的选中底色是**行盒**高度,而 Range.getClientRects() 给的是文字盒,
  // 两者差的就是行距(本项目 21px vs 19px,差 2px)—— 不补上高度就会"被压缩"。
  function expandSelectionRect(rect, lineHeight) {
    if (!Number.isFinite(lineHeight) || lineHeight <= rect.height) return rect;
    const extra = (lineHeight - rect.height) / 2;
    return {
      left: rect.left,
      top: rect.top - extra,
      right: rect.right,
      bottom: rect.bottom + extra,
      width: rect.width,
      height: rect.height + extra * 2,
    };
  }

  function collectSelectionRects() {
    pendingReplacedContent = [];
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return [];

    const items = [];

    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (range.collapsed) continue;

      const container = range.commonAncestorContainer;
      const element =
        container.nodeType === 1 ? container : container.parentElement;
      // 玻璃自身内部的选中不参与镜像
      if (!element || element.closest?.("[data-liquid-glass]")) continue;

      // ★ 只用「逐文本节点」的矩形,不要用 range.getClientRects()。
      //   原因:当选区**完整包含**某个块级元素时(例如跨卡片选区里整块被选中的
      //   .card-icon),range.getClientRects() 会返回该元素的整个盒子 → 玻璃里
      //   刷出一大片蓝,而那片区域并没有对应文字可重绘,图标就被"盖没了"。
      //   逐文本节点的子 Range 只会给出真正被选中的文字行矩形,并且每个节点
      //   都带自己的 ::selection 底色 / 行高。
      const nodes = collectSelectedTextNodes(range, element);
      nodes.forEach((item) => {
        const styleElement = item.node.parentElement || element;
        const nodeBackground = resolveSelectionBackground(
          styleElement,
          getComputedStyle(styleElement, "::selection"),
        );
        const nodeLineHeight = parseFloat(
          getComputedStyle(styleElement).lineHeight,
        );
        const sub = document.createRange();
        sub.setStart(item.node, item.start);
        sub.setEnd(item.node, item.end);
        const subRects = sub.getClientRects();
        for (let rectIndex = 0; rectIndex < subRects.length; rectIndex += 1) {
          const rect = subRects[rectIndex];
          if (rect.width <= 0.5 || rect.height <= 0.5) continue;
          items.push({
            rect: expandSelectionRect(rect, nodeLineHeight),
            background: nodeBackground,
          });
        }
      });

      // 图片 / 视频 / canvas 这类「替换元素」被选中时,Chrome 同样会在它们上面
      // 刷选中色(Ctrl+A 之后整张图是蓝的)。它们没有文本节点,所以必须单独收一遍;
      // 注意只收替换元素,不要收普通块级盒子 —— 那正是"整块卡片变蓝"的原因。
      const replacedSelector = "img, video, canvas, svg, object, embed";
      const replacedNodes =
        typeof element.querySelectorAll === "function"
          ? element.querySelectorAll(replacedSelector)
          : [];
      replacedNodes.forEach((node) => {
        if (node.closest?.("[data-liquid-glass]")) return;
        if (node.classList?.contains("liquid-glass-canvas")) return;
        if (node.classList?.contains("pdaim-line-field")) return;
        if (!range.intersectsNode(node)) return;
        // ★ 实测:Chrome 给 <img> 刷选中色只覆盖**内容盒**,不含 padding。
        //   像 iPhone 那张图有 padding:40px,用 border box 会把两边的白边
        //   也刷成淡蓝("两边很多白色、颜色还原不对"就是这么来的)。
        const box = node.getBoundingClientRect();
        const nodeStyle = getComputedStyle(node);
        const padLeft = parseCssLength(nodeStyle.paddingLeft, 0);
        const padRight = parseCssLength(nodeStyle.paddingRight, 0);
        const padTop = parseCssLength(nodeStyle.paddingTop, 0);
        const padBottom = parseCssLength(nodeStyle.paddingBottom, 0);
        // 选中范围:0 = 只内容盒(无头 Chrome 实测如此),1 = 边框盒(含 padding)。
        // 不同浏览器/版本对"图片被选中"的覆盖范围不一样:那张 iPhone 图有
        // padding:40px,若你的 Chrome 连 padding 一起刷,两侧留白就会比我们宽 40px
        // → 用 data-glass-selection-pad 对齐你实际看到的范围。
        const padScale = getSelectionPadScale();
        const insetLeft = padLeft * (1 - padScale);
        const insetRight = padRight * (1 - padScale);
        const insetTop = padTop * (1 - padScale);
        const insetBottom = padBottom * (1 - padScale);
        const rect = {
          left: box.left + insetLeft,
          top: box.top + insetTop,
          right: box.right - insetRight,
          bottom: box.bottom - insetBottom,
          width: Math.max(0, box.width - insetLeft - insetRight),
          height: Math.max(0, box.height - insetTop - insetBottom),
        };
        if (rect.width <= 0.5 || rect.height <= 0.5) return;
        // ★ 底色是**不透明**的(实测:内容盒留白处 Ctrl+A 后是 #3264ce ≈ 选中色本身),
        //   而"照片还能看见"是因为 Chrome 把图片内容重新叠在了选中色之上 ——
        //   所以这里先记下节点,稍后用 REPLACED_CONTENT_ALPHA 把内容补画回去。
        pendingReplacedContent.push(node);
        items.push({
          rect,
          background: resolveSelectionBackground(
            node,
            getComputedStyle(node, "::selection"),
          ),
        });
      });
    }

    return items;
  }

  // 选区底色画在文字下面,和浏览器的绘制顺序一致
  function drawSelectionLayer(ctx, canvasRect, dpr) {
    const items = collectSelectionRects();
    if (!items.length) return;

    items.forEach((item) => {
      if (!intersects(item.rect, canvasRect)) return;
      ctx.save();
      ctx.fillStyle = item.background;
      ctx.fillRect(
        (item.rect.left - canvasRect.left) * dpr,
        (item.rect.top - canvasRect.top) * dpr,
        item.rect.width * dpr,
        item.rect.height * dpr,
      );
      ctx.restore();
    });
  }

  // 选中底色是不透明的,替换元素(img/video/canvas)的内容要按
  // REPLACED_CONTENT_ALPHA 重新叠回去 —— Chrome 就是这样:留白处是纯选中色,
  // 而图片本身仍能隐约看见。
  function drawSelectionContentLayer(ctx, canvasRect, dpr, state) {
    if (!pendingReplacedContent.length) return;

    pendingReplacedContent.forEach((node) => {
      if (!node || !node.isConnected) return;
      if (node instanceof HTMLImageElement) {
        drawImageElement(
          ctx,
          node,
          canvasRect,
          dpr,
          state.skipUnsafeImages,
          REPLACED_CONTENT_ALPHA,
        );
        return;
      }
      // 视频 / 普通 canvas:直接按矩形半透明重画一次
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;
      ctx.save();
      ctx.globalAlpha = REPLACED_CONTENT_ALPHA;
      try {
        ctx.drawImage(
          node,
          (rect.left - canvasRect.left) * dpr,
          (rect.top - canvasRect.top) * dpr,
          rect.width * dpr,
          rect.height * dpr,
        );
      } catch (error) {}
      ctx.restore();
    });
  }

  // 选区里被 Range 覆盖到的文本节点,以及需要重绘的字符区间
  function collectSelectedTextNodes(range, element) {
    const items = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim())
          return NodeFilter.FILTER_REJECT;
        return range.intersectsNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue || "";
      const start = node === range.startContainer ? range.startOffset : 0;
      const end =
        node === range.endContainer ? range.endOffset : value.length;
      if (end > start) items.push({ node, start, end });
      node = walker.nextNode();
    }
    return items;
  }

  const SELECTION_CHAR_BUDGET = 1500; // 每帧逐字重绘的字符预算(成本保护)
  // 替换元素被选中时的覆盖范围:0 = 只内容盒,1 = 边框盒(含 padding)。
  // 见 data-glass-selection-pad 的注释。
  function getSelectionPadScale() {
    const value = parseFloat(root.dataset.glassSelectionPad || "");
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  }
  // 替换元素被选中时:底色不透明(实测),图片内容再以这个透明度叠回去,
  // 于是"留白处是纯选中色、照片仍能隐约看见" —— 与 Chrome 的观感一致。
  const REPLACED_CONTENT_ALPHA = 0.34;
  // collectSelectionRects 顺带收集"需要补画内容"的替换元素
  let pendingReplacedContent = [];

  // 把选中文字按高亮前景色重绘在最上层。
  // 底色是不透明的,已经把快照/镜像里原来的文字盖掉了,所以这里直接重画即可。
  function drawSelectionTextLayer(ctx, canvasRect, dpr) {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (range.collapsed) continue;

      const container = range.commonAncestorContainer;
      const element =
        container.nodeType === 1 ? container : container.parentElement;
      if (!element || element.closest?.("[data-liquid-glass]")) continue;

      const selectedText = range.toString();
      if (!selectedText) continue;

      const nodes = collectSelectedTextNodes(range, element);
      if (!nodes.length) continue;

      // 逐字测量很贵,所以先做"节点级粗筛",把玻璃外的整段直接跳过 ——
      // 开销只取决于"玻璃内有多少字",而不是"选区有多大"。
      // (之前按整个选区 400 字符一刀切,Ctrl+A 整页选中时白字整段不画,
      //  玻璃里就成了一片纯蓝。)
      let charBudget = SELECTION_CHAR_BUDGET;

      nodes.forEach((item) => {
        if (charBudget <= 0) return;
        // ★ 每个文本节点用它**自己**父元素的样式。
        //   range.commonAncestorContainer 在跨元素选区时往往是外层容器
        //   (例如 .cards,字号 16px / 常规体),拿它重绘会把标题(18px / 700)
        //   之类的文字画成又小又细 —— 这就是"选中两行后文字变小"的原因。
        const styleElement = item.node.parentElement || element;
        const style = getComputedStyle(styleElement);
        const selectionStyle = getComputedStyle(styleElement, "::selection");
        const color = resolveSelectionTextColor(selectionStyle, style.color);
        // 前景色与正文一样(或取不到)就不用重绘这一段
        if (color === style.color || isTransparentColor(color)) return;

        // 粗筛:这个节点被选中的部分有没有落在玻璃里
        const nodeRange = document.createRange();
        nodeRange.setStart(item.node, item.start);
        nodeRange.setEnd(item.node, item.end);
        const nodeRects = nodeRange.getClientRects();
        let overlaps = false;
        for (let r = 0; r < nodeRects.length; r += 1) {
          if (intersects(nodeRects[r], canvasRect)) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) return;

        // 注意:即使是 background-clip:text 的渐变文字,Chrome 选中它时文字
        // **仍然会变成 ::selection 的前景色(通常是白字)** —— 实测确认,
        // 所以这里不要用渐变去填充,必须用高亮前景色。
        const fillStyle = color;

        const value = item.node.nodeValue || "";
        ctx.save();
        ctx.font = canvasFontFromStyle(style, dpr);
        ctx.fillStyle = fillStyle;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        applyCanvasTextSpacing(ctx, style, dpr);
        ctx.globalAlpha = getCompositedOpacity(styleElement);

        // ★ 必须按「码点」迭代,不能按 UTF-16 码元。
        //   辅助平面字符(emoji,如 🌈 U+1F308 / 💡 U+1F4A1)占两个码元,
        //   用 value[i] 会把它拆成半个字符 → canvas 画出替换字形(问号)。
        //   ⚡ U+26A1、⏱ U+23F1 在 BMP 内只占一个码元,所以之前只有这两个正常。
        for (let i = item.start; i < item.end; ) {
          const codePoint = value.codePointAt(i);
          if (codePoint === undefined) break;
          const step = codePoint > 0xffff ? 2 : 1;
          const char = value.slice(i, i + step);
          if (/\s/.test(char)) {
            i += step;
            continue;
          }
          if (charBudget <= 0) break;
          charBudget -= 1;
          const charRange = document.createRange();
          charRange.setStart(item.node, i);
          charRange.setEnd(item.node, i + step);
          const rect = charRange.getBoundingClientRect();
          charRange.detach?.();
          if (!rect.width || !rect.height) {
            i += step;
            continue;
          }
          if (intersects(rect, canvasRect)) {
            ctx.fillText(
              char,
              (rect.left - canvasRect.left) * dpr,
              ((rect.top + rect.bottom) * 0.5 - canvasRect.top) * dpr,
            );
          }
          i += step;
        }

        ctx.restore();
      });
    }
  }

  // ===== 快照背景 =====
  // 手动镜像重绘只能覆盖 CSS 的一个子集:伪元素(::before/::after)、渐变文字
  // (-webkit-text-fill-color + background-clip:text)、text-decoration、
  // white-space、writing-mode、逐角圆角、box-shadow、filter、transform……
  // 这些全都要一条条补,永远补不完。用 foreignObject 把静态内容序列化后交给
  // 浏览器自己渲染,这一整类问题一次性消失。
  //
  // Chrome 上实测到的三个坑:
  //   1) 必须用 XMLSerializer。innerHTML 出来的 <br> / <img> 不是合法 XML,
  //      整个 SVG 会直接解析失败(image load error)。
  //   2) 必须用 data: URL。blob: URL 会让 foreignObject 快照被判定为跨源,
  //      canvas.getImageData 与 WebGL texImage2D 全部 SecurityError。
  //   3) SVG 里任何外链资源都会污染快照。所以图片 / 视频 / canvas 不放进快照,
  //      由覆盖层每帧绘制(它们本来就需要动态更新);CSS 里出现 url(...)
  //      外链时直接禁用快照,回退到镜像方案。
  const SNAPSHOT = {
    requested: root.dataset.glassBackdrop === "snapshot",
    enabled: root.dataset.glassBackdrop === "snapshot",
    ready: false,
    building: false,
    version: 0,
    builtVersion: -1,
    builtTheme: "",
    canvas: null,
    reason: "",
    timer: null,
  };

  let overlayCacheDirty = true;
  let overlayFixedRoots = [];
  let overlayMedia = [];

  function disableSnapshotBackdrop(reason) {
    SNAPSHOT.enabled = false;
    SNAPSHOT.ready = false;
    SNAPSHOT.building = false;
    SNAPSHOT.canvas = null;
    SNAPSHOT.reason = reason;
    if (window.console && console.info) {
      console.info("[liquid-glass] 快照背景不可用,已回退到镜像重绘: " + reason);
    }
  }

  function requestSnapshotBackdrop(delay) {
    if (!SNAPSHOT.requested) return;
    SNAPSHOT.version += 1;
    if (SNAPSHOT.timer) clearTimeout(SNAPSHOT.timer);
    // 结构变动往往连着一串,合并成一次重建
    SNAPSHOT.timer = setTimeout(() => {
      SNAPSHOT.timer = null;
      buildSnapshotBackdrop();
    }, typeof delay === "number" ? delay : 300);
  }

  function refreshOverlayCache() {
    overlayFixedRoots = [];
    overlayMedia = [];
    document.body.querySelectorAll("*").forEach((element) => {
      if (element.closest?.("[data-liquid-glass]")) return;
      if (element instanceof HTMLVideoElement) {
        overlayMedia.push(element);
        return;
      }
      if (!SNAPSHOT.requested) return;
      if (overlayFixedRoots.some((root) => root.contains(element))) return;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return;
      if (style.position === "fixed") overlayFixedRoots.push(element);
    });
    overlayCacheDirty = false;
  }

  // 快照模式下的覆盖层 = 图片 / 视频 / canvas + 固定定位子树(快照里被扣掉了)
  function isSnapshotOverlayTarget(element) {
    if (element instanceof HTMLImageElement) return true;
    if (element instanceof HTMLVideoElement) return true;
    if (element instanceof HTMLCanvasElement)
      return !element.classList.contains("liquid-glass-canvas");
    return overlayFixedRoots.some(
      (root) => root === element || root.contains(element),
    );
  }

  function mediaIsPlaying() {
    for (let index = 0; index < overlayMedia.length; index += 1) {
      const element = overlayMedia[index];
      if (
        element.isConnected &&
        !element.paused &&
        !element.ended &&
        element.readyState >= 2
      )
        return true;
    }
    return false;
  }

  function drawMediaElement(ctx, element, canvasRect, dpr) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || !intersects(rect, canvasRect)) return;
    if (element instanceof HTMLVideoElement && element.readyState < 2) return;

    ctx.save();
    ctx.globalAlpha = getCompositedOpacity(element);
    try {
      ctx.drawImage(
        element,
        (rect.left - canvasRect.left) * dpr,
        (rect.top - canvasRect.top) * dpr,
        rect.width * dpr,
        rect.height * dpr,
      );
    } catch (error) {}
    ctx.restore();
  }

  function collectPageCss() {
    let css = "";
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) css += rule.cssText + "\n";
      } catch (error) {
        // 跨源样式表读不到规则 → 快照会缺样式,直接放弃
        return "";
      }
    }
    return css;
  }

  const TRANSPARENT_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  // 图片/视频/canvas/iframe 的真实像素由覆盖层绘制,但**必须保留它们的占位盒子**:
  // 像 <img> 靠 CSS aspect-ratio 占位的情况,直接删掉元素会让整页排版塌陷,
  // 快照里的内容整体上移 —— 表现就是"玻璃拖到图片顶部,折射出来的却是下面的文字"。
  function keepSnapshotBox(live, node) {
    const rect = live.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    node.setAttribute("width", String(width));
    node.setAttribute("height", String(height));

    if (node instanceof HTMLImageElement) {
      // 换成透明像素:尺寸由上面的 width/height 与 CSS 决定,且不产生外链请求
      node.setAttribute("src", TRANSPARENT_PIXEL);
      node.removeAttribute("srcset");
      node.removeAttribute("sizes");
      node.removeAttribute("loading");
      node.removeAttribute("decoding");
      return;
    }
    if (node instanceof HTMLVideoElement) {
      node.removeAttribute("src");
      node.removeAttribute("poster");
      node.querySelectorAll("source").forEach((source) => source.remove());
      return;
    }
    if (node instanceof HTMLIFrameElement) {
      node.removeAttribute("src");
    }
  }

  function buildSnapshotSvg(layoutWidth, layoutHeight, dpr) {
    const css = collectPageCss();
    if (!css) return "";
    // 外链背景图 / 字体资源会污染快照
    if (/url\(\s*['"]?(?!data:)/i.test(css)) return "";

    // ★ 必须用布局视口宽度(clientWidth,不含滚动条),不能用 window.innerWidth。
    //   innerWidth 把滚动条算进去了,快照里没有滚动条 → 内容会按更宽的视口重新排版,
    //   居中的内容整体右移半个滚动条宽(约 7.5px),表现就是"玻璃里的边框整体偏右"。
    const width = Math.max(1, Math.round(layoutWidth));
    const height = Math.max(1, Math.round(layoutHeight));

    const clone = document.body.cloneNode(true);
    // 与实时树平行遍历:只在克隆侧 remove,两边的下标始终一一对应
    const liveAll = [document.body, ...document.body.querySelectorAll("*")];
    const cloneAll = [clone, ...clone.querySelectorAll("*")];

    for (let index = 0; index < liveAll.length; index += 1) {
      const live = liveAll[index];
      const node = cloneAll[index];
      if (!live || !node) continue;
      if (
        live.tagName === "SCRIPT" ||
        live.tagName === "NOSCRIPT" ||
        live.closest?.("[data-liquid-glass]")
      ) {
        node.remove();
        continue;
      }
      // 媒体元素只挖掉像素来源,保留盒子(见 keepSnapshotBox 注释)
      if (
        live instanceof HTMLImageElement ||
        live instanceof HTMLVideoElement ||
        live instanceof HTMLCanvasElement ||
        live instanceof HTMLIFrameElement
      ) {
        keepSnapshotBox(live, node);
        continue;
      }
      const style = getComputedStyle(live);
      // 固定定位在整页光栅化里会被钉在文档原点,交给覆盖层按视口位置画
      if (style.display === "none" || style.position === "fixed") node.remove();
    }

    const bodyStyle = getComputedStyle(document.body);
    const wrap = document.createElement("div");
    wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    wrap.setAttribute(
      "style",
      [
        "margin:0",
        "width:" + width + "px",
        "min-height:" + height + "px",
        "font-family:" + bodyStyle.fontFamily,
        "font-size:" + bodyStyle.fontSize,
        "font-weight:" + bodyStyle.fontWeight,
        "line-height:" + bodyStyle.lineHeight,
        "color:" + bodyStyle.color,
        "background-color:" + bodyStyle.backgroundColor,
        "letter-spacing:" + bodyStyle.letterSpacing,
        "text-align:" + bodyStyle.textAlign,
      ].join(";"),
    );

    const styleEl = document.createElement("style");
    styleEl.textContent = css;
    wrap.appendChild(styleEl);
    while (clone.firstChild) wrap.appendChild(clone.firstChild);

    // ★ 必须 XMLSerializer:HTML 序列化的 <br>/<img> 不是合法 XML
    const inner = new XMLSerializer().serializeToString(wrap);
    // ★ 必须用 viewBox 把「光栅化分辨率」和「CSS 布局尺寸」分开:
    //   只用 CSS 尺寸当 SVG 宽高的话,浏览器按 CSS 像素光栅化,再放大 dpr 倍
    //   就是一次上采样 —— 文字变粗变虚、容器边缘发毛。
    const rasterWidth = Math.round(width * dpr);
    const rasterHeight = Math.round(height * dpr);
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      rasterWidth +
      '" height="' +
      rasterHeight +
      '" viewBox="0 0 ' +
      width +
      " " +
      height +
      '"><foreignObject x="0" y="0" width="' +
      width +
      '" height="' +
      height +
      '">' +
      inner +
      "</foreignObject></svg>"
    );
  }

  function buildSnapshotBackdrop() {
    if (!SNAPSHOT.enabled || SNAPSHOT.building) return;
    if (SNAPSHOT.ready && SNAPSHOT.builtVersion === SNAPSHOT.version) return;

    const dpr = Math.min(window.devicePixelRatio || 1, getGlassDprLimit());
    // 布局尺寸:视口宽度用 clientWidth(不含滚动条),这样快照里的排版范围
    // 与真实页面的排版视口完全一致,居中的内容不会偏移。
    const layoutWidth = Math.max(
      1,
      Math.round(document.documentElement.clientWidth),
    );
    const layoutHeight = Math.max(
      1,
      Math.round(document.documentElement.scrollHeight),
    );
    const rasterWidth = Math.round(layoutWidth * dpr);
    const rasterHeight = Math.round(layoutHeight * dpr);
    if (rasterWidth > 4096 || rasterHeight > 8192) {
      disableSnapshotBackdrop("too-large:" + rasterWidth + "x" + rasterHeight);
      return;
    }
    // 快照画布与视口纹理同宽(innerWidth*dpr),右侧滚动条那一条留空
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = rasterHeight;

    let svg = "";
    try {
      svg = buildSnapshotSvg(layoutWidth, layoutHeight, dpr);
    } catch (error) {
      disableSnapshotBackdrop("build:" + (error && error.name));
      return;
    }
    if (!svg) {
      disableSnapshotBackdrop("css-unreadable-or-external-url");
      return;
    }

    SNAPSHOT.building = true;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const snapshotCtx = canvas.getContext("2d");
      try {
        // 1:1 绘制:SVG 已按 rasterWidth×rasterHeight(设备像素)光栅化,
        // 这里再缩放一次就等于二次上采样,会把边缘和文字弄糊。
        snapshotCtx.drawImage(image, 0, 0);
        // 被污染(有外链资源)会在这里抛 SecurityError → 回退镜像方案
        snapshotCtx.getImageData(0, 0, 1, 1);
      } catch (error) {
        disableSnapshotBackdrop("tainted:" + (error && error.name));
        return;
      }
      SNAPSHOT.canvas = canvas;
      SNAPSHOT.ready = true;
      SNAPSHOT.building = false;
      SNAPSHOT.builtVersion = SNAPSHOT.version;
      SNAPSHOT.builtTheme = root.dataset.theme || "";
      underlyingCacheDirty = true;
      overlayCacheDirty = true;
      invalidateGlassFrame();
    };
    image.onerror = () => disableSnapshotBackdrop("image-load");
    // ★ 必须 data: URL:blob: 会让快照被判为跨源,读不了像素
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function drawSnapshotBackdrop(ctx, rect, dpr) {
    const canvas = SNAPSHOT.canvas;
    if (!SNAPSHOT.ready || !canvas) return false;

    const sourceY = Math.max(0, Math.round(window.scrollY * dpr));
    const copyHeight = Math.min(
      canvas.height - sourceY,
      Math.round(rect.height * dpr),
    );
    if (copyHeight <= 0) return false;
    const copyWidth = Math.min(canvas.width, Math.round(rect.width * dpr));

    ctx.drawImage(
      canvas,
      0,
      sourceY,
      copyWidth,
      copyHeight,
      0,
      0,
      copyWidth,
      copyHeight,
    );
    return true;
  }

  function drawUnderlyingContent(
    ctx,
    canvasRect,
    dpr,
    state,
    host,
    overlayOnly,
  ) {
    if (underlyingCacheDirty) refreshUnderlyingCache();
    if (overlayCacheDirty) refreshOverlayCache();
    const elements = underlyingElements.filter(
      (element) => element.isConnected,
    );
    const images = underlyingImages.filter((image) => image.isConnected);

    elements.forEach((element) => {
      if (shouldSkipUnderlyingElement(element, host)) return;
      if (overlayOnly && !isSnapshotOverlayTarget(element)) return;
      // 视频与普通 canvas 直接当位图贴上去(镜像那套只会把它们画成空盒子)
      if (
        element instanceof HTMLVideoElement ||
        (element instanceof HTMLCanvasElement &&
          !element.classList.contains("liquid-glass-canvas") &&
          !element.classList.contains("pdaim-line-field"))
      ) {
        drawMediaElement(ctx, element, canvasRect, dpr);
        return;
      }
      if (
        element instanceof HTMLCanvasElement &&
        (element.classList.contains("liquid-glass-canvas") ||
          element.classList.contains("pdaim-line-field"))
      ) {
        drawCanvasElement(ctx, element, canvasRect, dpr);
        return;
      }
      if (element instanceof HTMLImageElement) return;
      drawElementBox(ctx, element, canvasRect, dpr);
    });

    images.forEach((image) => {
      if (shouldSkipUnderlyingElement(image, host)) return;
      if (image.currentSrc && image.currentSrc.includes("/captcha/")) return;
      drawImageElement(ctx, image, canvasRect, dpr, state.skipUnsafeImages);
    });

    // 选区底色要压在文字下面,所以放在文字两趟之前
    drawSelectionLayer(ctx, canvasRect, dpr);
    // 选中底色是不透明的,替换元素(图片/视频/canvas)的内容要按
    // REPLACED_CONTENT_ALPHA 补画回去,否则"图片被完全糊住"。
    drawSelectionContentLayer(ctx, canvasRect, dpr, state);

    elements.forEach((element) => {
      if (shouldSkipUnderlyingElement(element, host)) return;
      if (overlayOnly && !isSnapshotOverlayTarget(element)) return;
      if (element.children.length > 0) return;
      if (element instanceof HTMLImageElement) return;
      if (element instanceof HTMLCanvasElement) return;
      const rect = element.getBoundingClientRect();
      const intersectsCanvas = intersects(rect, canvasRect);
      const nearHeader = rect.top < 180 && rect.bottom > -40;
      if (!intersectsCanvas && !nearHeader) return;
      drawTextElement(ctx, element, canvasRect, dpr, {
        precise: nearHeader && shouldDrawPreciseText(canvasRect),
      });
    });

    elements.forEach((element) => {
      if (shouldSkipUnderlyingElement(element, host)) return;
      if (overlayOnly && !isSnapshotOverlayTarget(element)) return;
      if (!isCompositeTextElement(element)) return;
      drawTextElement(ctx, element, canvasRect, dpr, { precise: true });
    });

    // 选中文字的高亮前景色(通常是白字)必须画在所有文字之上
    drawSelectionTextLayer(ctx, canvasRect, dpr);

    drawCursorLayer(ctx, canvasRect, dpr);
  }

  function drawBackground(
    state,
    width,
    height,
    dpr,
    rect,
    gridX,
    gridY,
    gridOpacity,
    diagonalOpacity,
    refractionOpacity,
    bgColor,
    dotColor,
    force,
    host,
  ) {
    const needsResize = state.width !== width || state.height !== height;
    const needsScroll = Math.abs(state.scrollY - window.scrollY) > 0.5;
    const needsGrid =
      Math.abs(state.gridX - gridX) > 0.1 ||
      Math.abs(state.gridY - gridY) > 0.1;
    const needsBackgroundOpacity =
      Math.abs((state.gridOpacity ?? NaN) - gridOpacity) > 0.002 ||
      Math.abs((state.diagonalOpacity ?? NaN) - diagonalOpacity) > 0.002 ||
      Math.abs((state.refractionOpacity ?? NaN) - refractionOpacity) > 0.002;
    const needsColor = state.bgColor !== bgColor || state.dotColor !== dotColor;
    const needsRect =
      Math.abs((state.rectLeft ?? NaN) - rect.left) > 0.5 ||
      Math.abs((state.rectTop ?? NaN) - rect.top) > 0.5;
    if (
      !force &&
      !needsResize &&
      !needsScroll &&
      !needsGrid &&
      !needsBackgroundOpacity &&
      !needsColor &&
      !needsRect
    )
      return false;

    if (needsResize) {
      state.bg.width = width;
      state.bg.height = height;
      state.width = width;
      state.height = height;
    }

    state.scrollY = window.scrollY;
    state.gridX = gridX;
    state.gridY = gridY;
    state.gridOpacity = gridOpacity;
    state.diagonalOpacity = diagonalOpacity;
    state.refractionOpacity = refractionOpacity;
    state.bgColor = bgColor;
    state.dotColor = dotColor;
    state.rectLeft = rect.left;
    state.rectTop = rect.top;

    const ctx = state.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    const rootStyle = getComputedStyle(root);
    const fgColor =
      rootStyle.getPropertyValue("--fg").trim() ||
      (root.dataset.theme === "dark" ? "#ffffff" : "#070707");
    const heroBeforeX =
      (window.innerWidth * 0.07 - rect.left + window.innerWidth * 0.17) * dpr;
    const heroBeforeY =
      (window.innerHeight * 0.22 - rect.top + window.innerWidth * 0.17) * dpr;
    const heroAfterX =
      (window.innerWidth * 0.9 - rect.left - window.innerWidth * 0.17) * dpr;
    const heroAfterY =
      (window.innerHeight * 0.86 - rect.top - window.innerWidth * 0.17) * dpr;
    drawBlurredCircle(
      ctx,
      heroBeforeX,
      heroBeforeY,
      Math.min(window.innerWidth * 0.17, 260) * dpr,
      colorMixAlpha(fgColor, 0.04),
      60 * dpr,
    );
    drawBlurredCircle(
      ctx,
      heroAfterX,
      heroAfterY,
      Math.min(window.innerWidth * 0.17, 260) * dpr,
      colorMixAlpha(fgColor, 0.04),
      60 * dpr,
    );
    drawRefractionField(
      ctx,
      rect,
      dpr,
      fgColor,
      gridX,
      gridY,
      refractionOpacity,
    );

    if (gridOpacity > 0.001) {
      const spacing = 38 * dpr;
      const dotRadius = 1.05 * dpr;
      const pageLeft = -rect.left * dpr;
      const pageTop = -rect.top * dpr;
      const centerX = window.innerWidth * dpr * 0.5;
      const centerY = window.innerHeight * dpr * 0.5;
      const maxDim = Math.max(
        window.innerWidth * dpr,
        window.innerHeight * dpr,
      );
      const startX =
        ((((pageLeft + gridX * dpr) % spacing) + spacing) % spacing) - spacing;
      const startY =
        ((((pageTop + gridY * dpr) % spacing) + spacing) % spacing) - spacing;

      ctx.fillStyle = dotColor;
      for (let y = startY; y < height + spacing; y += spacing) {
        for (let x = startX; x < width + spacing; x += spacing) {
          const viewportX = rect.left * dpr + x - gridX * dpr;
          const viewportY = rect.top * dpr + y - gridY * dpr;
          const dist = Math.hypot(viewportX - centerX, viewportY - centerY);
          const mask = radialGridMask(dist / maxDim);
          if (mask <= 0.02) continue;

          ctx.globalAlpha = mask * gridOpacity;
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
    // 快照背景可用时:静态层直接用浏览器渲染好的位图,动态内容交给覆盖层
    const usedSnapshot =
      host === EXCLUDE_ALL_GLASS_HOSTS &&
      SNAPSHOT.ready &&
      drawSnapshotBackdrop(ctx, rect, dpr);
    drawUnderlyingContent(ctx, rect, dpr, state, host, usedSnapshot);
    return true;
  }

  function getInstanceOptions(host) {
    const style = getComputedStyle(host);
    const radius = parseCssLength(
      style.borderTopLeftRadius,
      host.getBoundingClientRect().height * 0.5,
    );
    const blur = parseCssLength(host.dataset.glassBlur || "", NaN);
    const dispersion = parseFloat(host.dataset.glassDispersion || "");
    const lens = parseFloat(host.dataset.glassLens || "");
    const glow = parseFloat(host.dataset.glassGlow || "");
    const refract = parseFloat(host.dataset.glassRefract || "");

    return {
      cornerRadius: radius,
      glassBlur: Number.isFinite(blur) ? blur : 20,
      // 折射带宽 = glassBlur × lens:调大 → 边缘折射范围更宽,调小 → 更窄更贴身
      lens: Number.isFinite(lens) ? Math.min(Math.max(lens, 0.2), 3) : 1.25,
      // 内部边缘光晕倍率:1 = 原版观感;调小 → 颜色更接近原色(但玻璃感变弱)。
      // 注意:实测它对"整体偏白"影响很小(0.5→0 平均色差 30.7→31),主要看观感。
      glow: Number.isFinite(glow) ? Math.min(Math.max(glow, 0), 1.5) : 1,
      // 折射位移幅度:调小 → 边缘"压扁/变小"更少(画面尺寸更接近原样)
      refract: Number.isFinite(refract) ? Math.min(Math.max(refract, 0), 2) : 0.6,
      // 色散强度,默认 6.25(原值);调小 → 文字更实、彩边更少
      dispersion: Number.isFinite(dispersion) ? dispersion : 6.25,
      alphaBoost: parseFloat(host.dataset.glassAlpha) || 1,
    };
  }

  const mobileGlassQuery = window.matchMedia(
    "(max-width: 720px), (pointer: coarse)",
  );
  const MAX_GLASS_OUTPUTS = 64;
  const MOBILE_MAX_GLASS_OUTPUTS = 1;
  const GLASS_DPR_LIMIT = 1.25;
  const MOBILE_GLASS_DPR_LIMIT = 0.85;

  // 玻璃纹理的 DPR 上限。默认 1.25 是原版的性能取舍:如果显示器缩放是 150%/200%,
  // 纹理只有屏幕的 83%/62.5%,再被放大就会"发虚"。用 <html data-glass-dpr-limit="2">
  // 可以拉到跟屏幕一致(更清晰,代价是像素量按平方增长)。
  function getGlassDprLimit() {
    if (isLiteGlassMode()) return MOBILE_GLASS_DPR_LIMIT;
    const configured = parseFloat(root.dataset.glassDprLimit || "");
    if (Number.isFinite(configured) && configured > 0)
      return Math.min(configured, 3);
    return GLASS_DPR_LIMIT;
  }
  const outputContexts = new WeakMap();
  const sharedBackground = createBackgroundCanvas();
  const localBackground = createBackgroundCanvas();
  const workCanvas = document.createElement("canvas");
  let frameSignature = "";
  let frameForceBackground = true;
  let activeTextureSource = "";
  let gl = null;
  let program = null;
  let buffer = null;
  let texture = null;
  let orbTexture = null;
  let lineTexture = null;
  let orbCanvas = null;
  let orbCtx = null;
  let orbTextureWidth = 0;
  let orbTextureHeight = 0;
  let locations = null;
  let contextLost = false;
  let lastRenderTime = 0;
  let lastRenderStamp = 0;
  let lineTextureFrame = "";
  let lineTextureUploaded = false;

  function isLiteGlassMode() {
    return mobileGlassQuery.matches;
  }

  function resolveHost(canvas) {
    return canvas.closest("[data-liquid-glass]") || canvas.parentElement;
  }

  function getOutputContext(canvas) {
    let ctx = outputContexts.get(canvas);
    if (!ctx) {
      ctx = canvas.getContext("2d", { alpha: true });
      if (ctx) outputContexts.set(canvas, ctx);
    }
    return ctx;
  }

  function getCanvasPriority(canvas, host, rect) {
    let priority = 20;
    if (host?.classList.contains("site-header")) priority = 0;
    else if (host?.classList.contains("theme-toggle-float")) priority = 1;
    else if (
      host?.classList.contains("nav-pill") ||
      host?.classList.contains("auth-button") ||
      host?.classList.contains("icon-button")
    )
      priority = 2;
    else if (host?.classList.contains("pdaim-license-card")) priority = 24;
    else if (host?.closest?.(".site-header")) priority = 4;
    else priority = 10;

    const centerX = (rect.left + rect.right) * 0.5;
    const centerY = (rect.top + rect.bottom) * 0.5;
    const distance = Math.hypot(
      centerX - window.innerWidth * 0.5,
      centerY - window.innerHeight * 0.5,
    );
    if (
      rect.bottom < -180 ||
      rect.top > window.innerHeight + 180 ||
      rect.right < -180 ||
      rect.left > window.innerWidth + 180
    ) {
      priority += 100;
    }
    return priority + distance / 10000;
  }

  function collectOutputItems() {
    const liteMode = isLiteGlassMode();
    if (liteMode) return [];
    const maxOutputs = MAX_GLASS_OUTPUTS;

    return Array.from(document.querySelectorAll(".liquid-glass-canvas"))
      .map((canvas) => {
        const host = resolveHost(canvas);
        if (!host || !host.isConnected || !canvas.isConnected) return null;

        const rect = canvas.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        if (!rect.width || !rect.height || !hostRect.width || !hostRect.height)
          return null;
        if (
          rect.bottom < -180 ||
          rect.top > window.innerHeight + 180 ||
          rect.right < -180 ||
          rect.left > window.innerWidth + 180
        )
          return null;

        const style = getComputedStyle(host);
        if (style.display === "none" || style.visibility === "hidden")
          return null;
        if (getCompositedOpacity(host) <= 0.01) return null;

        return {
          canvas,
          host,
          rect,
          hostRect,
          rank: getCanvasPriority(canvas, host, rect),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, maxOutputs);
  }

  function initRenderer() {
    try {
      gl = workCanvas.getContext("webgl", {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      });
      if (!gl) throw new Error("LiquidGlass WebGL unavailable");

      program = link(gl, vertexSource, fragmentSource);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1,
          1, 1, 1,
        ]),
        gl.STATIC_DRAW,
      );

      locations = {
        position: gl.getAttribLocation(program, "a_position"),
        texCoord: gl.getAttribLocation(program, "a_texCoord"),
        backgroundTexture: gl.getUniformLocation(program, "backgroundTexture"),
        orbTexture: gl.getUniformLocation(program, "orbTexture"),
        lineTexture: gl.getUniformLocation(program, "lineTexture"),
        resolution: gl.getUniformLocation(program, "resolution"),
        backgroundResolution: gl.getUniformLocation(
          program,
          "backgroundResolution",
        ),
        textureOffset: gl.getUniformLocation(program, "textureOffset"),
        lightPos: gl.getUniformLocation(program, "lightPos"),
        glassBlur: gl.getUniformLocation(program, "glassBlur"),
        refractionBlur: gl.getUniformLocation(program, "refractionBlur"),
        dispersion: gl.getUniformLocation(program, "dispersion"),
        glowScale: gl.getUniformLocation(program, "glowScale"),
        refractScale: gl.getUniformLocation(program, "refractScale"),
        cornerRadius: gl.getUniformLocation(program, "cornerRadius"),
        shapeSize: gl.getUniformLocation(program, "shapeSize"),
        alphaBoost: gl.getUniformLocation(program, "alphaBoost"),
        darkAmount: gl.getUniformLocation(program, "darkAmount"),
        viewportOffset: gl.getUniformLocation(program, "viewportOffset"),
        lineFieldOpacity: gl.getUniformLocation(program, "lineFieldOpacity"),
      };

      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      orbCanvas = document.createElement("canvas");
      orbCtx = orbCanvas.getContext("2d", { alpha: true });
      orbTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, orbTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      lineTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, lineTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.SCISSOR_TEST);

      workCanvas.addEventListener(
        "webglcontextlost",
        (event) => {
          event.preventDefault();
          contextLost = true;
          root.classList.add("liquid-glass-global-failed");
        },
        false,
      );

      root.classList.add("liquid-glass-global-ready");
      return true;
    } catch (error) {
      root.classList.add("liquid-glass-global-failed");
      return false;
    }
  }

  function uploadSharedBackground(metrics, paintState) {
    const rect = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    };

    const changed = drawBackground(
      sharedBackground,
      metrics.viewportWidth,
      metrics.viewportHeight,
      metrics.dpr,
      rect,
      paintState.gridX,
      paintState.gridY,
      paintState.gridOpacity,
      paintState.diagonalOpacity,
      paintState.refractionOpacity,
      paintState.bgColor,
      paintState.dotColor,
      frameForceBackground,
      EXCLUDE_ALL_GLASS_HOSTS,
    );
    if (
      !changed &&
      sharedBackground.textureUploaded &&
      activeTextureSource === "shared"
    )
      return true;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        sharedBackground.bg,
      );
      sharedBackground.textureUploaded = true;
      activeTextureSource = "shared";
      return true;
    } catch (error) {
      if (!error || error.name !== "SecurityError") throw error;
      sharedBackground.skipUnsafeImages = true;
      sharedBackground.warnedTaintedCanvas = true;
      sharedBackground.bg.width = metrics.viewportWidth;
      sharedBackground.bg.height = metrics.viewportHeight;
      sharedBackground.width = metrics.viewportWidth;
      sharedBackground.height = metrics.viewportHeight;
      drawBackground(
        sharedBackground,
        metrics.viewportWidth,
        metrics.viewportHeight,
        metrics.dpr,
        rect,
        paintState.gridX,
        paintState.gridY,
        paintState.gridOpacity,
        paintState.diagonalOpacity,
        paintState.refractionOpacity,
        paintState.bgColor,
        paintState.dotColor,
        true,
        EXCLUDE_ALL_GLASS_HOSTS,
      );
      try {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          sharedBackground.bg,
        );
        sharedBackground.textureUploaded = true;
        activeTextureSource = "shared";
        return true;
      } catch (retryError) {
        return false;
      }
    }
  }

  function needsLocalBackground(item, items) {
    if (item.host.dataset?.glassIsolate === "true") return true;
    const insideHeader = item.host.closest?.(".site-header");
    const isItemDetailPage =
      /^\/item\/\d+/.test(window.location.pathname || "") ||
      (window.location.pathname || "").includes("/user/index/item");
    if (insideHeader) {
      if (isItemDetailPage) return true;
      if (!item.host.classList.contains("site-header")) return false;
    }
    if (!item.host.classList.contains("site-header")) return false;
    return items.some(
      (other) =>
        other !== item &&
        other.host !== item.host &&
        !item.host.contains(other.host) &&
        !other.host.contains(item.host) &&
        intersects(item.hostRect, other.hostRect),
    );
  }

  function uploadLocalBackground(item, metrics, paintState) {
    const { rect, host } = item;
    const width = Math.max(1, Math.round(rect.width * metrics.dpr));
    const height = Math.max(1, Math.round(rect.height * metrics.dpr));

    const changed = drawBackground(
      localBackground,
      width,
      height,
      metrics.dpr,
      rect,
      paintState.gridX,
      paintState.gridY,
      paintState.gridOpacity,
      paintState.diagonalOpacity,
      paintState.refractionOpacity,
      paintState.bgColor,
      paintState.dotColor,
      frameForceBackground,
      host,
    );
    if (
      !changed &&
      localBackground.textureUploaded &&
      activeTextureSource === "local"
    )
      return true;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        localBackground.bg,
      );
      localBackground.textureUploaded = true;
      activeTextureSource = "local";
      return true;
    } catch (error) {
      if (!error || error.name !== "SecurityError") throw error;
      localBackground.skipUnsafeImages = true;
      localBackground.warnedTaintedCanvas = true;
      localBackground.bg.width = width;
      localBackground.bg.height = height;
      localBackground.width = width;
      localBackground.height = height;
      drawBackground(
        localBackground,
        width,
        height,
        metrics.dpr,
        rect,
        paintState.gridX,
        paintState.gridY,
        paintState.gridOpacity,
        paintState.diagonalOpacity,
        paintState.refractionOpacity,
        paintState.bgColor,
        paintState.dotColor,
        true,
        host,
      );
      try {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          localBackground.bg,
        );
        localBackground.textureUploaded = true;
        activeTextureSource = "local";
        return true;
      } catch (retryError) {
        return false;
      }
    }
  }

  function uploadOrbTexture(metrics, paintState) {
    if (!orbCtx || !orbTexture) return false;

    const width = Math.max(1, Math.round(metrics.viewportWidth * 0.25));
    const height = Math.max(1, Math.round(metrics.viewportHeight * 0.25));
    const scaleX = width / metrics.viewportWidth;
    const scaleY = height / metrics.viewportHeight;
    const scale = Math.min(scaleX, scaleY);

    if (orbCanvas.width !== width || orbCanvas.height !== height) {
      orbCanvas.width = width;
      orbCanvas.height = height;
      orbTextureWidth = width;
      orbTextureHeight = height;
    }

    const time = performance.now() * 0.001;
    const baseRadius = Math.min(metrics.viewportWidth, metrics.viewportHeight);
    // 真实玻璃散射 — 柔和白光高光，无人工色彩
    const defs = [
      {
        x: 0.18,
        y: 0.22,
        dx: 0.24,
        dy: 0.16,
        speed: 0.62,
        phase: 0.0,
        radius: 0.28,
        color: [1.0, 1.0, 1.0],
        strength: [0.06, 0.08],
      },
      {
        x: 0.78,
        y: 0.18,
        dx: -0.2,
        dy: 0.18,
        speed: 0.73,
        phase: 1.7,
        radius: 0.25,
        color: [1.0, 1.0, 1.0],
        strength: [0.05, 0.07],
      },
      {
        x: 0.72,
        y: 0.76,
        dx: -0.22,
        dy: -0.18,
        speed: 0.51,
        phase: 3.1,
        radius: 0.3,
        color: [1.0, 1.0, 1.0],
        strength: [0.05, 0.07],
      },
      {
        x: 0.28,
        y: 0.78,
        dx: 0.2,
        dy: -0.22,
        speed: 0.68,
        phase: 0.8,
        radius: 0.24,
        color: [0.95, 0.95, 1.0],
        strength: [0.04, 0.06],
      },
      {
        x: 0.5,
        y: 0.48,
        dx: 0.16,
        dy: 0.14,
        speed: 0.44,
        phase: 2.4,
        radius: 0.33,
        color: [1.0, 1.0, 1.0],
        strength: [0.04, 0.06],
      },
    ];

    orbCtx.setTransform(1, 0, 0, 1, 0, 0);
    orbCtx.clearRect(0, 0, width, height);
    orbCtx.globalCompositeOperation = "source-over";

    defs.forEach(function (orb) {
      var waveA = Math.sin(time * orb.speed + orb.phase);
      var waveB = Math.cos(time * (orb.speed * 0.73 + 0.17) + orb.phase * 1.37);
      var ox = metrics.viewportWidth * (orb.x + orb.dx * waveA) * scaleX;
      var oy = metrics.viewportHeight * (orb.y + orb.dy * waveB) * scaleY;
      var or = baseRadius * orb.radius * scale;
      var strength = paintState.refractionOpacity * orb.strength[0];
      var cr = Math.round(orb.color[0] * 255);
      var cg = Math.round(orb.color[1] * 255);
      var cb = Math.round(orb.color[2] * 255);
      const gradient = orbCtx.createRadialGradient(
        ox,
        oy,
        or * 0.08,
        ox,
        oy,
        or,
      );
      gradient.addColorStop(
        0,
        "rgba(" + cr + ", " + cg + ", " + cb + ", " + strength + ")",
      );
      gradient.addColorStop(1, "rgba(" + cr + ", " + cg + ", " + cb + ", 0)");
      orbCtx.fillStyle = gradient;
      orbCtx.beginPath();
      orbCtx.arc(ox, oy, or, 0, Math.PI * 2);
      orbCtx.fill();
    });

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, orbTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      orbCanvas,
    );
    return true;
  }

  function uploadLineTexture() {
    if (!lineTexture) return false;
    const canvas = document.querySelector("#pdaimLineField");
    if (!canvas || !canvas.width || !canvas.height) return false;
    const frame = canvas.dataset.frame || "0";
    if (lineTextureUploaded && frame === lineTextureFrame) return true;

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lineTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        canvas,
      );
      lineTextureFrame = frame;
      lineTextureUploaded = true;
      return true;
    } catch (error) {
      return false;
    }
  }

  function renderOutput(item, paintState, metrics) {
    const { canvas, host, rect, hostRect } = item;
    const dpr = metrics.dpr;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    const outputCtx = getOutputContext(canvas);
    if (!outputCtx) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const options = getInstanceOptions(host);
    const shapeWidth = Math.max(1, Math.round(hostRect.width * dpr));
    const shapeHeight = Math.max(1, Math.round(hostRect.height * dpr));
    const cornerRadius = Math.min(
      options.cornerRadius * dpr,
      shapeHeight * 0.5,
      shapeWidth * 0.5,
    );
    const glassBlur = options.glassBlur * dpr;
    const refractionBlur = glassBlur * options.lens;
    const dispersion = options.dispersion * dpr;
    const darkAmount = root.dataset.theme === "dark" ? 1 : 0;

    gl.viewport(0, 0, width, height);
    gl.scissor(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(locations.texCoord);
    gl.vertexAttribPointer(locations.texCoord, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(locations.backgroundTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, orbTexture);
    gl.uniform1i(locations.orbTexture, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lineTexture);
    gl.uniform1i(locations.lineTexture, 2);
    gl.uniform2f(locations.resolution, width, height);
    // ★ 采样偏移必须取整:小数偏移会让 LINEAR 采样落在纹素之间 ——
    //   拖动时画面发虚、边缘像在抖。取整后是 1:1 采样,又清晰又稳。
    const sampleOffsetX = Math.round(rect.left * dpr);
    const sampleOffsetY = Math.round(rect.top * dpr);
    if (item.localBackground) {
      gl.uniform2f(locations.backgroundResolution, width, height);
      gl.uniform2f(locations.textureOffset, 0, 0);
      gl.uniform2f(locations.viewportOffset, sampleOffsetX, sampleOffsetY);
    } else {
      gl.uniform2f(
        locations.backgroundResolution,
        metrics.viewportWidth,
        metrics.viewportHeight,
      );
      gl.uniform2f(locations.textureOffset, sampleOffsetX, sampleOffsetY);
      gl.uniform2f(locations.viewportOffset, sampleOffsetX, sampleOffsetY);
    }
    gl.uniform2f(locations.lightPos, width * 0.25, height * 0.25);
    gl.uniform1f(locations.glassBlur, glassBlur);
    gl.uniform1f(locations.refractionBlur, refractionBlur);
    gl.uniform1f(locations.dispersion, dispersion);
    gl.uniform1f(locations.glowScale, options.glow);
    gl.uniform1f(locations.refractScale, options.refract);
    gl.uniform1f(locations.cornerRadius, cornerRadius);
    gl.uniform2f(locations.shapeSize, shapeWidth, shapeHeight);
    gl.uniform1f(locations.alphaBoost, options.alphaBoost);
    gl.uniform1f(locations.darkAmount, darkAmount);
    gl.uniform1f(locations.lineFieldOpacity, paintState.lineFieldOpacity || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    outputCtx.setTransform(1, 0, 0, 1, 0, 0);
    outputCtx.clearRect(0, 0, width, height);
    outputCtx.drawImage(
      workCanvas,
      0,
      workCanvas.height - height,
      width,
      height,
      0,
      0,
      width,
      height,
    );
  }

  function render() {
    if (!gl || contextLost || gl.isContextLost()) return;
    lastRenderStamp = performance.now();

    const dpr = Math.min(window.devicePixelRatio || 1, getGlassDprLimit());
    const metrics = {
      dpr,
      viewportWidth: Math.max(1, Math.round(window.innerWidth * dpr)),
      viewportHeight: Math.max(1, Math.round(window.innerHeight * dpr)),
    };
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    const isOverviewPage = Boolean(
      document.querySelector(".hero[data-route-page='overview']"),
    );
    const paintState = {
      gridX: parseFloat(rootStyle.getPropertyValue("--grid-x")) || 0,
      gridY: parseFloat(rootStyle.getPropertyValue("--grid-y")) || 0,
      gridOpacity: isOverviewPage
        ? clamp01(parseFloat(rootStyle.getPropertyValue("--grid-opacity")))
        : 0,
      diagonalOpacity: isOverviewPage
        ? clamp01(parseFloat(rootStyle.getPropertyValue("--diagonal-opacity")))
        : 0,
      refractionOpacity: clamp01(
        parseFloat(rootStyle.getPropertyValue("--refraction-opacity")),
      ),
      lineFieldOpacity: clamp01(
        parseFloat(rootStyle.getPropertyValue("--line-field-opacity")),
      ),
      dotColor:
        rootStyle.getPropertyValue("--dot").trim() ||
        (root.dataset.theme === "dark"
          ? "rgba(255,255,255,0.34)"
          : "rgba(7,7,7,0.34)"),
      bgColor:
        bodyStyle.backgroundColor ||
        (root.dataset.theme === "dark" ? "#050505" : "#ffffff"),
    };
    const effectiveGridX =
      paintState.gridOpacity > 0.001 ? paintState.gridX : 0;
    const effectiveGridY =
      paintState.gridOpacity > 0.001 ? paintState.gridY : 0;

    // 主题切换会改变整页配色,快照需要重建
    if (
      SNAPSHOT.enabled &&
      SNAPSHOT.ready &&
      SNAPSHOT.builtTheme !== (root.dataset.theme || "")
    ) {
      requestSnapshotBackdrop();
    }

    const nextFrameSignature = [
      metrics.viewportWidth,
      metrics.viewportHeight,
      metrics.dpr,
      Math.round(window.scrollY * 2) / 2,
      effectiveGridX.toFixed(1),
      effectiveGridY.toFixed(1),
      paintState.gridOpacity.toFixed(3),
      paintState.diagonalOpacity.toFixed(3),
      paintState.refractionOpacity.toFixed(3),
      paintState.lineFieldOpacity.toFixed(3),
      paintState.dotColor,
      paintState.bgColor,
      root.dataset.theme || "",
      underlyingCacheDirty ? "dirty" : "clean",
      overlayCacheDirty ? "odirty" : "oclean",
      mediaIsPlaying() ? "playing" : "idle",
    ].join("|");
    frameForceBackground = nextFrameSignature !== frameSignature;
    if (frameForceBackground) {
      frameSignature = nextFrameSignature;
      sharedBackground.textureUploaded = false;
      localBackground.textureUploaded = false;
      activeTextureSource = "";
    }

    const items = collectOutputItems();
    let maxWorkWidth = 1;
    let maxWorkHeight = 1;
    items.forEach((item) => {
      maxWorkWidth = Math.max(maxWorkWidth, Math.round(item.rect.width * dpr));
      maxWorkHeight = Math.max(
        maxWorkHeight,
        Math.round(item.rect.height * dpr),
      );
    });

    if (workCanvas.width < maxWorkWidth || workCanvas.height < maxWorkHeight) {
      const pad = 64;
      const newW = Math.max(
        workCanvas.width,
        Math.ceil(maxWorkWidth / pad) * pad,
      );
      const newH = Math.max(
        workCanvas.height,
        Math.ceil(maxWorkHeight / pad) * pad,
      );
      if (workCanvas.width !== newW) workCanvas.width = newW;
      if (workCanvas.height !== newH) workCanvas.height = newH;
    }

    items.forEach((item) => {
      item.localBackground = needsLocalBackground(item, items);
    });

    if (!items.length) return;
    paintState.gridX = effectiveGridX;
    paintState.gridY = effectiveGridY;
    if (!uploadSharedBackground(metrics, paintState)) return;
    if (!uploadOrbTexture(metrics, paintState)) return;
    if (!uploadLineTexture()) paintState.lineFieldOpacity = 0;

    items
      .filter((item) => !item.localBackground)
      .forEach((item) => {
        try {
          renderOutput(item, paintState, metrics);
        } catch (error) {}
      });

    items
      .filter((item) => item.localBackground)
      .forEach((item) => {
        try {
          if (!uploadLocalBackground(item, metrics, paintState)) return;
          renderOutput(item, paintState, metrics);
        } catch (error) {}
      });
  }

  function loop(now) {
    const liteMode = isLiteGlassMode();
    const minInterval = liteMode ? 1000 / 24 : 1;
    if (!liteMode || now - lastRenderTime >= minInterval) {
      lastRenderTime = now;
      if (now - lastRenderStamp >= 1) render();
    }
    requestAnimationFrame(loop);
  }

  function renderForScroll() {
    if (isLiteGlassMode()) return;
    lastRenderTime = performance.now();
    render();
  }

  // 丢弃已缓存的背景纹理,让下一帧用最新内容重绘并重新上传。
  // 帧签名只覆盖滚动 / 尺寸 / 主题 / 配色,任何异步到达的绘制资源(图片、字体)
  // 都必须主动失效,否则首次绘制时尚未加载完成的内容会被永久缓存下来。
  function invalidateGlassFrame() {
    underlyingCacheDirty = true;
    frameSignature = "";
    render();
  }

  // ===== 调试辅助:控制台一行命令调参(只在调试时用,不影响正常渲染)=====
  // 用法(浏览器 F12 → Console):
  //   glassTune()                        // 打印当前所有玻璃参数
  //   glassTune({ blur: 12, lens: 0.9 })  // 立即生效(不用改文件)
  //   glassTune("reset")                  // 全部恢复成 index.html 里写的值
  function installGlassTune() {
    const KEY_MAP = {
      blur: "glassBlur",
      lens: "glassLens",
      refract: "glassRefract",
      glow: "glassGlow",
      dispersion: "glassDispersion",
      alpha: "glassAlpha",
    };
    const hosts = () =>
      Array.from(document.querySelectorAll("[data-liquid-glass]"));

    const read = (host) => ({
      blur: host.dataset.glassBlur ?? "(默认 20) 折射/模糊半径",
      lens: host.dataset.glassLens ?? "(默认 1.25) 折射带宽度倍率",
      refract: host.dataset.glassRefract ?? "(默认 0.6) 折射位移幅度(越小越不压扁)",
      glow: host.dataset.glassGlow ?? "(默认 1) 内部边缘光晕",
      dispersion: host.dataset.glassDispersion ?? "(默认 6.25) 色散强度",
      alpha: host.dataset.glassAlpha ?? "(默认 1) 玻璃不透明度倍数",
    });

    // 记录页面里(HTML 属性)的初始值:reset 要回到"文件里的值",
    // 而不是代码默认值 —— 否则把参数固化进 index.html 之后 reset 就失效了。
    const initialValues = new WeakMap();
    const rememberInitial = (host) => {
      if (initialValues.has(host)) return;
      const snapshot = {};
      Object.values(KEY_MAP).forEach((key) => {
        if (host.dataset[key] !== undefined) snapshot[key] = host.dataset[key];
      });
      initialValues.set(host, snapshot);
    };
    const initialDprLimit = root.dataset.glassDprLimit;
    let dprLimitRemembered = initialDprLimit !== undefined;
    const initialSelectionPad = root.dataset.glassSelectionPad;

    window.glassTune = (options) => {
      const list = hosts();
      if (!list.length) return "没有找到 [data-liquid-glass] 宿主";

      if (!options) {
        const out = {
          "DPR 上限(<html>)": root.dataset.glassDprLimit ?? "(默认 1.25)",
          "图片选中范围(<html>)":
            root.dataset.glassSelectionPad ??
            "(默认 0) 0=只内容盒, 1=含 padding",
        };
        list.forEach((host, index) => {
          out["宿主" + (list.length > 1 ? index : "") + " " + (host.className || host.tagName)] = read(host);
        });
        if (window.console && console.table) console.table(out);
        return out;
      }

      if (options === "reset") {
        list.forEach((host) => {
          rememberInitial(host);
          const snapshot = initialValues.get(host) || {};
          Object.values(KEY_MAP).forEach((key) => delete host.dataset[key]);
          Object.keys(snapshot).forEach((key) => {
            host.dataset[key] = snapshot[key];
          });
        });
        if (dprLimitRemembered) root.dataset.glassDprLimit = initialDprLimit;
        else delete root.dataset.glassDprLimit;
        if (initialSelectionPad !== undefined)
          root.dataset.glassSelectionPad = initialSelectionPad;
        else delete root.dataset.glassSelectionPad;
      } else {
        list.forEach((host) => {
          rememberInitial(host);
          Object.keys(KEY_MAP).forEach((key) => {
            if (!(key in options)) return;
            const value = options[key];
            if (value === null || value === undefined) delete host.dataset[KEY_MAP[key]];
            else host.dataset[KEY_MAP[key]] = String(value);
          });
          if ("dprLimit" in options) {
            if (options.dprLimit === null || options.dprLimit === undefined)
              delete root.dataset.glassDprLimit;
            else root.dataset.glassDprLimit = String(options.dprLimit);
          }
          if ("selectionPad" in options) {
            if (
              options.selectionPad === null ||
              options.selectionPad === undefined
            )
              delete root.dataset.glassSelectionPad;
            else
              root.dataset.glassSelectionPad = String(options.selectionPad);
          }
        });
      }
      document.dispatchEvent(new Event("pdaim:liquid-refresh"));
      window.glassTune();
      return options === "reset"
        ? "已恢复 index.html 里的默认值"
        : "已应用 " + JSON.stringify(options) + "(刷新页面即可还原)";
    };

    if (window.console && console.info) {
      console.info(
        "[liquid-glass] 调参:glassTune() 查看当前值 / glassTune({blur:12,lens:0.9}) 立即生效 / glassTune('reset') 还原",
      );
    }
  }

  if (initRenderer()) {
    installGlassTune();
    window.addEventListener("resize", render, { passive: true });
    // 窗口尺寸变化会改变排版,快照需要重建
    window.addEventListener("resize", () => requestSnapshotBackdrop(350), {
      passive: true,
    });
    mobileGlassQuery.addEventListener?.("change", () => {
      frameSignature = "";
      render();
    });
    window.addEventListener("scroll", renderForScroll, { passive: true });
    document.addEventListener("pdaim:liquid-refresh", () => {
      invalidateGlassFrame();
    });

    // 图片加载完成 / 加载失败时刷新背景缓存。
    // 未加载完成的图片会被画成占位图(drawImageFallback),之前没有监听 load,
    // 导致拖拽玻璃经过图片时一直显示占位图而不是真实图片。
    // load / error 不冒泡,但捕获阶段会在 document 上收到。
    document.addEventListener(
      "load",
      (event) => {
        if (event.target instanceof HTMLImageElement) invalidateGlassFrame();
      },
      true,
    );

    document.addEventListener(
      "error",
      (event) => {
        if (event.target instanceof HTMLImageElement) invalidateGlassFrame();
      },
      true,
    );

    // 字体延迟加载会改变文字排版,同样需要重绘,否则玻璃里保留备用字体的排版。
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(
        () => {
          invalidateGlassFrame();
          requestSnapshotBackdrop(0);
        },
        () => {},
      );
    }

    // 选区变化(拖选、点击取消、Ctrl+A)时重绘,否则玻璃里看不到选中底色。
    // 只在「有选区」或「刚刚还有选区」时才重绘,避免光标移动触发无谓重绘。
    let hadSelection = false;
    document.addEventListener("selectionchange", () => {
      const selection = window.getSelection?.();
      const hasSelection = Boolean(
        selection && !selection.isCollapsed && selection.rangeCount,
      );
      if (!hasSelection && !hadSelection) return;
      hadSelection = hasSelection;
      invalidateGlassFrame();
    });

    // DOM 结构变化(增删节点)时刷新缓存,并重建快照
    new MutationObserver(() => {
      underlyingCacheDirty = true;
      overlayCacheDirty = true;
      frameSignature = "";
      requestSnapshotBackdrop();
    }).observe(document.body, { childList: true, subtree: true });

    // 快照背景首次构建(失败会自动回退到镜像重绘)
    if (SNAPSHOT.requested) requestSnapshotBackdrop(0);

    requestAnimationFrame(loop);
  }
})();
