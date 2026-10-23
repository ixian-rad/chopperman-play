import * as THREE from 'three';

/**
 * Dynamic Time-of-Day, Sun/Sky/Lantern Lighting, Volumetric God Rays,
 * and Weather Simulation (Sun, Rain, Snow/Frost, Wind, Fog) with Physics Modifiers.
 */
export class AtmosphereController {
  constructor(scene, environment, lights, physContacts) {
    this.scene = scene;
    this.env = environment;
    this.lights = lights; // { hemiLight, sunLight, rimLight, porchLight, yardLight }
    this.physContacts = physContacts; // { woodGroundContact, woodWoodContact, steelWoodContact }

    this.timeOfDay = 17.15; // Default: Golden Hour (5:09 PM)
    this.autoCycleTime = false;
    this.weather = 'sun'; // 'sun' | 'rain' | 'snow' | 'wind' | 'fog'
    this.clock = 0;

    // Live wind vector (affects trees, weather particles, flying wood chips, and aim sway)
    this.windVector = new THREE.Vector3(0.4, 0, 0.1);
    this.windStrength = 0.2;

    this.weatherGroup = new THREE.Group();
    this.weatherGroup.name = 'AtmosphereAndWeatherGroup';
    this.scene.add(this.weatherGroup);

    this._buildSunAndGodRays();
    this._buildLanternHalos();
    this._buildRainParticles();
    this._buildSnowParticles();
    this._buildWindAndMoteParticles();
    this._buildFogMistLayers();

    this.setTimeOfDay(this.timeOfDay);
    this.setWeather(this.weather);
  }

  _buildSunAndGodRays() {
    // Visible Sun Disc in the sky
    const sunGeo = new THREE.SphereGeometry(2.6, 16, 12);
    this.sunDiscMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4,
      fog: false
    });
    this.sunDisc = new THREE.Mesh(sunGeo, this.sunDiscMat);
    this.weatherGroup.add(this.sunDisc);

    // Volumetric God-Ray Sunbeam Cones with soft gradient alpha falloff
    this.godRayGroup = new THREE.Group();
    this.godRayGroup.name = 'VolumetricGodRays';
    this.weatherGroup.add(this.godRayGroup);

    const rayCanvas = document.createElement('canvas');
    rayCanvas.width = 64;
    rayCanvas.height = 128;
    const rCtx = rayCanvas.getContext('2d');
    const rGrad = rCtx.createLinearGradient(0, 0, 0, 128);
    rGrad.addColorStop(0.0, 'rgba(255, 232, 175, 0.0)');
    rGrad.addColorStop(0.3, 'rgba(255, 232, 175, 0.85)');
    rGrad.addColorStop(0.75, 'rgba(255, 224, 155, 0.45)');
    rGrad.addColorStop(1.0, 'rgba(255, 224, 155, 0.0)');
    rCtx.fillStyle = rGrad;
    rCtx.fillRect(0, 0, 64, 128);
    const rayAlphaTex = new THREE.CanvasTexture(rayCanvas);

    this.godRayMat = new THREE.MeshBasicMaterial({
      color: 0xffe4a8,
      map: rayAlphaTex,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const rayOffsets = [
      [-3.2, 1.8, -3.6, 1.1, 12.0],
      [-0.8, 2.1, -4.2, 1.35, 13.0],
      [2.4, 1.9, -3.8, 1.2, 12.5],
      [4.5, 2.2, -4.6, 1.3, 13.0]
    ];

    this.godRayMeshes = [];
    rayOffsets.forEach(([ox, oy, oz, radius, len]) => {
      const coneGeo = new THREE.ConeGeometry(radius, len, 12, 1, true);
      // Shift cone so its apex is near the canopy/sunward side and base fans toward ground
      const mesh = new THREE.Mesh(coneGeo, this.godRayMat);
      mesh.userData = { targetOffset: new THREE.Vector3(ox, oy, oz), len };
      this.godRayGroup.add(mesh);
      this.godRayMeshes.push(mesh);
    });
  }

  _buildLanternHalos() {
    // Soft additive glow halos around the yard lantern and house porch lantern
    const haloGeo = new THREE.SphereGeometry(0.32, 12, 10);
    this.lanternHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffb85c,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.yardHalo = new THREE.Mesh(haloGeo, this.lanternHaloMat);
    this.yardHalo.position.set(-1.03, 1.63, 0.15);
    this.weatherGroup.add(this.yardHalo);

    this.porchHalo = new THREE.Mesh(haloGeo.clone(), this.lanternHaloMat);
    this.porchHalo.position.set(-0.38, 2.45, -9.02);
    this.weatherGroup.add(this.porchHalo);
  }

  _buildRainParticles() {
    const count = 420;
    const positions = new Float32Array(count * 6); // 2 vertices per rain streak
    this.rainVel = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 18;
      const y = Math.random() * 10;
      const z = (Math.random() - 0.5) * 16 - 1;
      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      positions[idx + 3] = x;
      positions[idx + 4] = y - 0.42;
      positions[idx + 5] = z;
      this.rainVel[i] = 11.5 + Math.random() * 4.5;
    }

    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const rainMat = new THREE.LineBasicMaterial({
      color: 0xa8ccf0,
      transparent: true,
      opacity: 0.58
    });
    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.rainLines.visible = false;
    this.weatherGroup.add(this.rainLines);
  }

  _buildSnowParticles() {
    const count = 360;
    const positions = new Float32Array(count * 3);
    this.snowPhase = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = Math.random() * 9.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16 - 1;
      this.snowPhase[i] = Math.random() * Math.PI * 2;
    }

    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const snowMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.065,
      transparent: true,
      opacity: 0.88
    });
    this.snowPoints = new THREE.Points(snowGeo, snowMat);
    this.snowPoints.visible = false;
    this.weatherGroup.add(this.snowPoints);
  }

  _buildWindAndMoteParticles() {
    // Floating golden dust motes (Sun) / blowing leaf & dust specks (Wind)
    const count = 140;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 1] = 0.25 + Math.random() * 4.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 1;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.moteMat = new THREE.PointsMaterial({
      color: 0xffe4a0,
      size: 0.045,
      transparent: true,
      opacity: 0.65
    });
    this.motePoints = new THREE.Points(moteGeo, this.moteMat);
    this.weatherGroup.add(this.motePoints);
  }

  _buildFogMistLayers() {
    this.fogGroup = new THREE.Group();
    this.fogGroup.visible = false;
    this.weatherGroup.add(this.fogGroup);

    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xd8e4ee,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mistPlanes = [];
    for (let i = 0; i < 4; i++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), mistMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, 0.18 + i * 0.32, -1.0);
      this.fogGroup.add(plane);
      this.mistPlanes.push(plane);
    }
  }

  /**
   * Sets time of day (hours 0.0 to 24.0) and updates sun trajectory, sky gradient,
   * god rays, shadows, and backyard lanterns.
   */
  setTimeOfDay(hours) {
    this.timeOfDay = ((Number(hours) % 24) + 24) % 24;

    // Compute solar elevation angle: sunrise ~ 6:00, solar noon ~ 12:30, sunset ~ 19:00
    const dayAngle = ((this.timeOfDay - 6.0) / 13.0) * Math.PI;
    const sinElev = Math.sin(dayAngle);
    const isDay = this.timeOfDay >= 5.6 && this.timeOfDay <= 19.4;
    const isGolden =
      (this.timeOfDay >= 5.8 && this.timeOfDay <= 7.8) ||
      (this.timeOfDay >= 16.2 && this.timeOfDay <= 18.8);
    const isNight = !isDay;

    // Position the Sun (or Moon at night)
    const azimuth = ((this.timeOfDay - 12.5) / 12.0) * Math.PI * 0.75;
    const elev = isDay
      ? Math.max(0.08, sinElev * 1.15)
      : 0.45 + Math.abs(Math.sin(dayAngle)) * 0.35;
    const dist = 16.0;
    const sx = Math.sin(azimuth) * Math.cos(elev) * dist;
    const sy = Math.max(1.8, Math.sin(elev) * dist);
    const sz = Math.cos(azimuth) * Math.cos(elev) * dist;

    this.lights.sunLight.position.set(sx, sy, sz);
    this.sunDisc.position.set(sx * 4.5, sy * 4.5, sz * 4.5);

    // Overcast weather dims direct sunlight
    const weatherSunDim =
      this.weather === 'rain'
        ? 0.42
        : this.weather === 'fog'
        ? 0.52
        : this.weather === 'snow'
        ? 0.68
        : 1.0;

    let skyTop = '#2c5d9e';
    let skyMid = '#6298d4';
    let skyHoriz = '#f3dec3';
    let fogHex = 0xcbdbe8;

    if (isNight) {
      // Cool moonlit suburban night + bright warm lanterns
      this.lights.sunLight.color.setHex(0x6b8ec2);
      this.lights.sunLight.intensity = 0.45 * weatherSunDim;
      this.lights.hemiLight.color.setHex(0x2d4363);
      this.lights.hemiLight.groundColor.setHex(0x162018);
      this.lights.hemiLight.intensity = 0.38;
      this.sunDiscMat.color.setHex(0xdbeafe);
      skyTop = '#09111e';
      skyMid = '#15253d';
      skyHoriz = '#263a52';
      fogHex = 0x182434;
    } else if (isGolden) {
      // Warm amber/rose New Jersey Golden Hour / Dawn
      this.lights.sunLight.color.setHex(0xffd296);
      this.lights.sunLight.intensity = 2.45 * weatherSunDim;
      this.lights.hemiLight.color.setHex(0xfce3c8);
      this.lights.hemiLight.groundColor.setHex(0x4b5c32);
      this.lights.hemiLight.intensity = 0.72;
      this.sunDiscMat.color.setHex(0xffdfa0);
      skyTop = '#294c82';
      skyMid = '#6d8fb8';
      skyHoriz = '#f5ba84';
      fogHex = 0xdecbb8;
    } else {
      // Crisp bright midday
      this.lights.sunLight.color.setHex(0xfffaf0);
      this.lights.sunLight.intensity = 2.65 * weatherSunDim;
      this.lights.hemiLight.color.setHex(0xdcf0ff);
      this.lights.hemiLight.groundColor.setHex(0x4f6b38);
      this.lights.hemiLight.intensity = 0.85;
      this.sunDiscMat.color.setHex(0xffffff);
      skyTop = '#1f5aa6';
      skyMid = '#589be0';
      skyHoriz = '#cbe3f7';
      fogHex = 0xc8dff0;
    }

    // Weather overrides for sky & fog color
    if (this.weather === 'rain') {
      skyTop = isNight ? '#0a1017' : '#3a4959';
      skyMid = isNight ? '#16202b' : '#5b6c7d';
      skyHoriz = isNight ? '#212d3b' : '#8596a6';
      fogHex = isNight ? 0x16202b : 0x7a8b99;
    } else if (this.weather === 'snow') {
      skyTop = isNight ? '#121b28' : '#6f859c';
      skyMid = isNight ? '#213042' : '#9cb0c4';
      skyHoriz = isNight ? '#34465c' : '#d8e4f0';
      fogHex = isNight ? 0x243242 : 0xcfe0ed;
    } else if (this.weather === 'fog') {
      skyTop = isNight ? '#151e26' : '#7b8c99';
      skyMid = isNight ? '#24313d' : '#a3b3bf';
      skyHoriz = isNight ? '#32414f' : '#cad6e0';
      fogHex = isNight ? 0x263340 : 0xc4d2de;
    }

    this._redrawSkyCanvas(skyTop, skyMid, skyHoriz, isNight);
    this.scene.background.setHex(fogHex);
    if (this.scene.fog) {
      this.scene.fog.color.setHex(fogHex);
    }

    // Lanterns & warm house windows glow strongly at Golden Hour, Dusk, Night, or Rain/Fog
    const lanternFactor = isNight
      ? 1.0
      : isGolden
      ? 0.72
      : this.weather === 'rain' || this.weather === 'fog'
      ? 0.55
      : 0.1;

    this.lights.yardLight.intensity = lanternFactor * 2.8;
    this.lights.porchLight.intensity = lanternFactor * 1.9;
    this.env.lanternBulbMat.emissiveIntensity = 0.25 + lanternFactor * 2.5;
    this.env.warmWindowMat.emissiveIntensity = 0.1 + lanternFactor * 0.85;
    this.lanternHaloMat.opacity = lanternFactor * 0.34;
    this.yardHalo.visible = lanternFactor > 0.15;
    this.porchHalo.visible = lanternFactor > 0.15;

    // Volumetric God Rays orient from the sun toward the chopping yard
    const showGodRays =
      isDay && (this.weather === 'sun' || this.weather === 'wind') && sy < 13.5;
    this.godRayGroup.visible = showGodRays;
    if (showGodRays) {
      const sunDir = new THREE.Vector3(sx, sy, sz).normalize();
      const upVec = new THREE.Vector3(0, 1, 0);
      const rayQuat = new THREE.Quaternion().setFromUnitVectors(upVec, sunDir);
      this.godRayMat.opacity = isGolden ? 0.095 : 0.055;

      this.godRayMeshes.forEach((mesh) => {
        const { targetOffset, len } = mesh.userData;
        mesh.position
          .copy(targetOffset)
          .addScaledVector(sunDir, len * 0.45);
        mesh.quaternion.copy(rayQuat);
      });
    }
  }

  _redrawSkyCanvas(topHex, midHex, horizHex, isNight) {
    const ctx = this.env.skyCtx;
    const w = this.env.skyCanvas.width;
    const h = this.env.skyCanvas.height;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, topHex);
    grad.addColorStop(0.52, midHex);
    grad.addColorStop(0.92, horizHex);
    grad.addColorStop(1.0, horizHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (isNight && this.weather !== 'rain' && this.weather !== 'fog') {
      // Draw crisp night stars in upper hemisphere
      ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
      for (let s = 0; s < 75; s++) {
        const sx = (s * 67) % w;
        const sy = (s * 29) % Math.floor(h * 0.58);
        const r = s % 4 === 0 ? 1.3 : 0.8;
        ctx.fillRect(sx, sy, r, r);
      }
    } else {
      // Soft clouds
      for (let i = 0; i < 22; i++) {
        const cx = (i * 47) % w;
        const cy = 36 + ((i * 19) % 45);
        const rx = 16 + (i % 4) * 9;
        const ry = 4 + (i % 3) * 2.5;
        ctx.fillStyle = isNight
          ? 'rgba(120, 145, 180, 0.08)'
          : 'rgba(255, 252, 245, 0.18)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    this.env.skyTexture.needsUpdate = true;
  }

  /**
   * Switches active weather condition ('sun', 'rain', 'snow', 'wind', 'fog')
   * and applies both visual and real physical/gameplay changes.
   */
  setWeather(weatherType) {
    this.weather = weatherType || 'sun';

    this.rainLines.visible = this.weather === 'rain';
    this.env.puddleGroup.visible = this.weather === 'rain';

    this.snowPoints.visible = this.weather === 'snow';
    this.env.snowGroup.visible = this.weather === 'snow';

    this.motePoints.visible = this.weather === 'sun' || this.weather === 'wind';
    this.moteMat.color.setHex(this.weather === 'wind' ? 0xd9822b : 0xffe4a0);
    this.moteMat.size = this.weather === 'wind' ? 0.068 : 0.045;

    this.fogGroup.visible = this.weather === 'fog';

    // Update Fog density
    if (this.scene.fog) {
      const densities = {
        sun: 0.012,
        wind: 0.013,
        rain: 0.025,
        snow: 0.028,
        fog: 0.058
      };
      this.scene.fog.density = densities[this.weather] || 0.012;
    }

    // Update surface PBR wetness / frostiness & cannon-es Physics Contact Materials!
    if (this.weather === 'rain') {
      // Wet glossy surfaces + slippery physics
      this.env.groundMat.roughness = 0.42;
      this.env.mulchMat.roughness = 0.35;
      this.physContacts.woodGroundContact.friction = 0.28;
      this.physContacts.woodWoodContact.friction = 0.24;
      this.physContacts.steelWoodContact.friction = 0.15;
      this.physContacts.woodWoodContact.restitution = 0.2;
      this.windStrength = 0.45;
    } else if (this.weather === 'snow') {
      // Frosty ground + brittle, high-restitution frozen wood physics
      this.env.groundMat.roughness = 0.78;
      this.env.mulchMat.roughness = 0.75;
      this.physContacts.woodGroundContact.friction = 0.35;
      this.physContacts.woodWoodContact.friction = 0.38;
      this.physContacts.steelWoodContact.friction = 0.25;
      this.physContacts.woodWoodContact.restitution = 0.42;
      this.windStrength = 0.35;
    } else if (this.weather === 'wind') {
      this.env.groundMat.roughness = 0.92;
      this.env.mulchMat.roughness = 0.96;
      this.physContacts.woodGroundContact.friction = 0.62;
      this.physContacts.woodWoodContact.friction = 0.55;
      this.physContacts.steelWoodContact.friction = 0.35;
      this.physContacts.woodWoodContact.restitution = 0.28;
      this.windStrength = 1.15;
    } else {
      // Sun or Fog
      this.env.groundMat.roughness = this.weather === 'fog' ? 0.68 : 0.92;
      this.env.mulchMat.roughness = this.weather === 'fog' ? 0.65 : 0.96;
      this.physContacts.woodGroundContact.friction = 0.62;
      this.physContacts.woodWoodContact.friction = 0.55;
      this.physContacts.steelWoodContact.friction = 0.35;
      this.physContacts.woodWoodContact.restitution = 0.28;
      this.windStrength = 0.18;
    }

    // Refresh lighting colors for the new weather
    this.setTimeOfDay(this.timeOfDay);
  }

  /**
   * Steps time-of-day cycle, wind gusts, tree sway, puddle ripples, and weather particles.
   */
  update(dt) {
    this.clock += dt;

    if (this.autoCycleTime) {
      this.setTimeOfDay(this.timeOfDay + dt * 0.25);
    }

    // Compute live gusting wind vector
    const gust =
      (Math.sin(this.clock * 1.9) * 0.5 + Math.cos(this.clock * 3.4) * 0.5 + 1.0) *
      this.windStrength;
    this.windVector.set(
      (1.2 + Math.sin(this.clock * 0.7) * 0.4) * gust,
      0,
      Math.cos(this.clock * 0.9) * 0.35 * gust
    );

    // Sway backyard trees & evergreens with wind
    for (const target of this.env.swayTargets) {
      const w = Math.sin(this.clock * 2.2 + target.phase) * 0.035 * target.amp * (0.4 + gust);
      target.node.rotation.z = -w - this.windVector.x * 0.025;
      target.node.rotation.x = w * 0.4 + this.windVector.z * 0.025;
    }

    // Flicker yard lantern subtly
    if (this.lights.yardLight.intensity > 0.1) {
      const flicker = 1.0 + Math.sin(this.clock * 19.0) * 0.03 + Math.cos(this.clock * 31.0) * 0.02;
      this.yardHalo.scale.setScalar(flicker);
    }

    // Update Rain Streaks & Puddle Ripples
    if (this.weather === 'rain') {
      const posAttr = this.rainLines.geometry.attributes.position;
      const arr = posAttr.array;
      const count = this.rainVel.length;
      const wx = this.windVector.x * 1.8;

      for (let i = 0; i < count; i++) {
        const idx = i * 6;
        const speed = this.rainVel[i];
        arr[idx] += wx * dt;
        arr[idx + 1] -= speed * dt;

        if (arr[idx + 1] < 0) {
          arr[idx] = (Math.random() - 0.5) * 16;
          arr[idx + 1] = 9.0 + Math.random() * 2.0;
          arr[idx + 2] = (Math.random() - 0.5) * 14 - 1;
        }
        arr[idx + 3] = arr[idx] - wx * 0.032;
        arr[idx + 4] = arr[idx + 1] - 0.42;
        arr[idx + 5] = arr[idx + 2];
      }
      posAttr.needsUpdate = true;

      // Animate expanding raindrop ripple rings on puddles
      for (const r of this.env.rippleRings) {
        r.phase = (r.phase + dt * 1.35) % 1.0;
        const scale = 0.5 + r.phase * 3.8;
        r.mesh.scale.set(scale, scale, 1);
        r.mat.opacity = (1.0 - r.phase) * 0.52;
      }
    }

    // Update Snowflakes
    if (this.weather === 'snow') {
      const posAttr = this.snowPoints.geometry.attributes.position;
      const arr = posAttr.array;
      const count = this.snowPhase.length;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const ph = this.snowPhase[i] + this.clock * 1.8;
        arr[idx] += (Math.sin(ph) * 0.45 + this.windVector.x * 0.8) * dt;
        arr[idx + 1] -= (1.35 + (i % 5) * 0.18) * dt;
        arr[idx + 2] += Math.cos(ph * 0.8) * 0.35 * dt;

        if (arr[idx + 1] < 0.02) {
          arr[idx] = (Math.random() - 0.5) * 16;
          arr[idx + 1] = 8.5 + Math.random() * 1.5;
          arr[idx + 2] = (Math.random() - 0.5) * 14 - 1;
        }
      }
      posAttr.needsUpdate = true;
    }

    // Update Sun Motes / Blowing Wind Leaves
    if (this.motePoints.visible) {
      const posAttr = this.motePoints.geometry.attributes.position;
      const arr = posAttr.array;
      const count = arr.length / 3;
      const isWindy = this.weather === 'wind';

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        arr[idx] += (this.windVector.x * (isWindy ? 2.6 : 0.4) + Math.sin(this.clock + i) * 0.15) * dt;
        arr[idx + 1] += Math.cos(this.clock * 1.4 + i) * 0.18 * dt;
        arr[idx + 2] += this.windVector.z * (isWindy ? 1.8 : 0.3) * dt;

        if (arr[idx] > 8) arr[idx] = -8;
        if (arr[idx] < -8) arr[idx] = 8;
      }
      posAttr.needsUpdate = true;
    }

    // Drift Fog Mist layers slowly
    if (this.fogGroup.visible) {
      this.mistPlanes.forEach((plane, idx) => {
        plane.position.x = Math.sin(this.clock * 0.35 + idx) * 1.2;
        plane.rotation.z = this.clock * 0.04 * (idx % 2 === 0 ? 1 : -1);
      });
    }
  }
}
