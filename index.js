// index.js
const width = 800;
const height = 600;

const svg = d3.select("#map")
  .attr("width", width)
  .attr("height", height);

const treemapSvg = d3.select("#treemap");
const treemapContainer = d3.select("#treemap-container");
const treemapTitle = d3.select("#treemap-title");
const legend = d3.select("#legend");
const tooltip = d3.select("#tooltip");

// Échelle de couleur pour la carte
const colorScale = d3.scaleSequential(d3.interpolateReds);

// Échelle de couleur pour le treemap
const treemapColorScale = d3.scaleOrdinal(d3.schemeCategory10);

Promise.all([
  d3.json("https://cdn.jsdelivr.net/npm/morocco-map/data/regions.json"),
  d3.json("./covid_regions_maroc.json"),
])
  .then(([mapData, covidData, hierarchicalData]) => {

    const regions = topojson.feature(mapData, mapData.objects.regions);

    const projection = d3.geoMercator().fitSize([width, height], regions);
    const pathGenerator = d3.geoPath().projection(projection);

    // Index COVID par nom de région
    function normalize(str) {
      return (str || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    }

    const covidByRegion = {};
    const covidByCode = {};
    const covidById = {};
    const covidByNorm = {};

    // Construire un mapping hiérarchique générique pour le treemap et indexer les données COVID
    const hierarchicalMap = {};
    covidData.forEach(r => {
      const code = r.Code || r.id || normalize(r.region);
      const numbers = {};
      const percentages = {};
      const others = {};

      Object.keys(r).forEach(key => {
        if (key === 'region' || key === 'Code' || key === 'id' || key === 'latitude' || key === 'longitude') return;
        const val = r[key];
        if (val == null) return;
        // Nombre
        if (typeof val === 'number' && !isNaN(val)) {
          numbers[key] = val;
          return;
        }
        // Pourcentages au format "10.80%"
        if (typeof val === 'string' && val.trim().endsWith('%')) {
          const n = parseFloat(val.replace('%', '').replace(',', '.'));
          if (!isNaN(n)) {
            percentages[key] = n;
            return;
          }
        }
        // Chaînes numériques possibles
        if (typeof val === 'string') {
          const maybeNum = parseFloat(val.replace(/,/g, ''));
          if (!isNaN(maybeNum)) {
            numbers[key] = maybeNum;
            return;
          }
        }
        // Autres (texte)
        others[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
      });

      const categories = {};
      if (Object.keys(numbers).length) categories['Numbers'] = numbers;
      if (Object.keys(percentages).length) categories['Percentages'] = percentages;
      if (Object.keys(others).length) categories['Other'] = Object.fromEntries(
        Object.entries(others).map(([k, v]) => [k, 0])
      );

      const entry = {
        region: r.region || '',
        categories: categories,
        data: r,
        Code: r.Code || r.id || code
      };

      // Indexer entry par plusieurs clés pour robustesse
      if (r.Code) hierarchicalMap[r.Code] = entry;
      if (r.id) hierarchicalMap[r.id] = entry;
      if (r.region) hierarchicalMap[r.region] = entry;
      hierarchicalMap[code] = entry; // normalized fallback

      // Index pour recherches rapides
      if (r.region) covidByRegion[r.region] = r;
      if (r.Code) covidByCode[r.Code] = r;
      if (r.id) covidById[r.id] = r;
      covidByNorm[normalize(r.region)] = r;
    });

    // Si `hierarchicalData` est un tableau, convertir en mapping pour accès par code/nom
    let hierarchicalDataMap = hierarchicalData;
    if (Array.isArray(hierarchicalData)) {
      hierarchicalDataMap = {};
      hierarchicalData.forEach(r => {
        const keyNorm = normalize(r.region);
        if (r.Code) hierarchicalDataMap[r.Code] = r;
        if (r.id) hierarchicalDataMap[r.id] = r;
        if (r.region) hierarchicalDataMap[r.region] = r;
        hierarchicalDataMap[keyNorm] = r;
      });
    }

    // Construire dynamiquement des catégories à partir d'un enregistrement brut
    function buildCategoriesFromRaw(r) {
      const numbers = {};
      const percentages = {};
      const others = {};
      Object.keys(r).forEach(key => {
        if (key === 'region' || key === 'Code' || key === 'id' || key === 'latitude' || key === 'longitude') return;
        const val = r[key];
        if (val == null) return;
        if (typeof val === 'number' && !isNaN(val)) {
          numbers[key] = val;
          return;
        }
        if (typeof val === 'string' && val.trim().endsWith('%')) {
          const n = parseFloat(val.replace('%', '').replace(',', '.'));
          if (!isNaN(n)) {
            percentages[key] = n;
            return;
          }
        }
        if (typeof val === 'string') {
          const maybeNum = parseFloat(val.replace(/,/g, ''));
          if (!isNaN(maybeNum)) {
            numbers[key] = maybeNum;
            return;
          }
        }
        others[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
      });
      const categories = {};
      if (Object.keys(numbers).length) categories['Numbers'] = numbers;
      if (Object.keys(percentages).length) categories['Percentages'] = percentages;
      if (Object.keys(others).length) categories['Other'] = Object.fromEntries(
        Object.entries(others).map(([k, v]) => [k, 0])
      );
      return categories;
    }

    // Retourne un objet normalisé { region, categories, data, Code }
    function getHierarchicalForInfo(info) {
      if (!info) return null;
      const keysToTry = [info.Code, info.id, info.region, normalize(info.region)];
      for (const k of keysToTry) {
        if (!k) continue;
        if (hierarchicalDataMap && hierarchicalDataMap[k]) {
          const raw = hierarchicalDataMap[k];
          // si déjà structuré avec categories
          if (raw.categories) return raw;
          return {
            region: raw.region || info.region || '',
            categories: buildCategoriesFromRaw(raw),
            data: raw,
            Code: raw.Code || raw.id || k
          };
        }
        if (hierarchicalMap && hierarchicalMap[k]) {
          return hierarchicalMap[k];
        }
      }
      return null;
    }

    // Fonction pour retrouver les infos COVID à partir d'une feature GeoJSON
    function findInfo(feature) {
      const props = feature.properties || {};
      const name = props.name || props['name:en'] || props.NAME_1 || props.NAME || props.nom || props.NOM || props.REGION || props.region || '';
      const code = (props.code || props.id || props.ID || props.iso || '').toString();

      // Try direct code lookups
      if (code && covidByCode[code]) return covidByCode[code];
      if (code && covidById[code]) return covidById[code];

      // Try name-based lookups
      if (name && covidByRegion[name]) return covidByRegion[name];

      const n = normalize(name);
      if (n && covidByNorm[n]) return covidByNorm[n];

      // fuzzy matching by normalized region name
      const MIN_FUZZY = 4;
      if (n && n.length >= MIN_FUZZY) {
        for (let k in covidByRegion) {
          const nk = normalize(k);
          if (!nk || nk.length < MIN_FUZZY) continue;
          if (nk.includes(n) || n.includes(nk)) {
            console.debug('Fuzzy match', name, '->', k);
            return covidByRegion[k];
          }
        }
      }

      console.warn('No COVID data match for feature:', name, 'normalized:', n, 'props:', props);
      return null;
    }

    const maxCases = d3.max(covidData, d => d.Confirmed);
    colorScale.domain([0, maxCases || 1]);

    // Dessiner la carte
    svg.selectAll("path")
      .data(regions.features)
      .enter()
      .append("path")
      .attr("class", "region")
      .attr("d", pathGenerator)
      .attr("fill", d => {
        const info = findInfo(d);
        return info ? colorScale(info.Confirmed) : "#cecfd4ff";
      })
      .on("mouseover", function (event, d) {
        const info = findInfo(d);
        const props = d.properties || {};

        if (info) {
          tooltip.style("display", "block")
            .html(`
            <strong>${info.region}</strong><br/>
            Cas confirmés: ${info.Confirmed}<br/>
            Décès: ${info.Deaths}<br/>
            Guérisons: ${info.Recovered}<br/>
            Population: ${info.population}<br/>
            PIB: ${info.contribution_gdp}
          `);
          // Also update treemap on hover with the region's data
          const h = getHierarchicalForInfo(info);
          if (h) {
            showTreemap(h.Code || info.Code || info.id || normalize(info.region), h);
          }
        }

        d3.select(this).style("opacity", 0.6);
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 10) + "px");
      })
      .on("mouseout", function () {
        tooltip.style("display", "none");
        d3.select(this).style("opacity", 0.88);
      })
      .on("click", function (event, d) {
        const info = findInfo(d);
        if (!info) return;

        // Recherche robuste des données hiérarchiques : d'abord dans hierarchicalDataMap, sinon dans hierarchicalMap
        const keysToTry = [info.Code, info.id, info.region, normalize(info.region)];
        let hdata = null;
        for (const k of keysToTry) {
          if (!k) continue;
          if (hierarchicalDataMap && hierarchicalDataMap[k]) {
            hdata = hierarchicalDataMap[k];
            break;
          }
          if (hierarchicalMap && hierarchicalMap[k]) {
            hdata = hierarchicalMap[k];
            break;
          }
        }

        if (hdata) {
          // If the structure is from hierarchicalMap we stored region/categories differently
          if (!hdata.categories && hdata.data) {
            showTreemap(info.Code || info.id || normalize(info.region), hdata);
          } else {
            showTreemap(info.Code || info.id || normalize(info.region), hdata);
          }
        }
      });

    // Fonction pour afficher le treemap
    function showTreemap(regionCode, regionData) {
      treemapContainer.style("display", "block");
      treemapTitle.text(`Treemap - ${regionData.region}`);

      // Nettoyer le treemap précédent
      treemapSvg.selectAll("*").remove();
      legend.selectAll("*").remove();

      // Préparer les données hiérarchiques pour D3
      const root = {
        name: regionData.region,
        children: Object.entries(regionData.categories).map(([category, subcategories]) => ({
          name: category,
          children: Object.entries(subcategories).map(([subcategory, value]) => ({
            name: subcategory,
            value: value
          }))
        }))
      };

      // Créer la hiérarchie
      const hierarchy = d3.hierarchy(root)
        .sum(d => d.value)
        .sort((a, b) => b.value - a.value);

      // Créer le treemap
      const treemapLayout = d3.treemap()
        .size([780, 350])
        .padding(1);

      treemapLayout(hierarchy);

      // Créer les groupes pour chaque feuille
      const leaves = treemapSvg.selectAll("g")
        .data(hierarchy.leaves())
        .enter()
        .append("g")
        .attr("transform", d => `translate(${d.x0},${d.y0})`);

      // Ajouter les rectangles
      leaves.append("rect")
        .attr("width", d => d.x1 - d.x0)
        .attr("height", d => d.y1 - d.y0)
        .attr("fill", d => {
          const category = d.parent.data.name;
          return treemapColorScale(category);
        })
        .attr("stroke", "#fff")
        .on("mouseover", function (event, d) {
          tooltip.style("display", "block")
            .html(`
            <strong>${d.data.name}</strong><br/>
            Catégorie: ${d.parent.data.name}<br/>
            Valeur: ${d.data.value}
          `);
        })
        .on("mousemove", function (event) {
          tooltip.style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function () {
          tooltip.style("display", "none");
        });

      // Ajouter le texte
      leaves.append("text")
        .selectAll("tspan")
        .data(d => d.data.name.split(/(?=[A-Z][^A-Z])/g))
        .enter()
        .append("tspan")
        .attr("x", 4)
        .attr("y", (d, i) => 13 + i * 10)
        .text(d => d)
        .style("font-size", "10px")
        .style("fill", "#333");

      // Créer la légende
      const categories = Object.keys(regionData.categories);
      const legendItems = legend.selectAll(".legend-item")
        .data(categories)
        .enter()
        .append("div")
        .attr("class", "legend-item");

      legendItems.append("div")
        .attr("class", "legend-color")
        .style("background-color", d => treemapColorScale(d));

      legendItems.append("span")
        .text(d => d)
        .style("font-size", "12px");
    }

  })
  .catch(err => console.error(err));