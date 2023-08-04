// export {default as DendroHeatmap} from "./src/DendroHeatmap";

/*
 * Mayya Sedova <msedova.dev@gmail.com>
 */

(function () {


    DendroHeatmap = function (textdata, parent) {

        // console.log(data)
        // console.log(parent)

        d3.select(parent).selectAll("*").remove();
        if (!textdata)
            return;


        let margin = {
            top: 150,
            right: 50,
            bottom: 10,
            left: 50,
            legend: {
                top: -100,
                left: 10,
                width: 50,
                height: 50
            }
        };

        //matrix cell size
        const cellSize = 10;
        // depth of the panel with the tree
        const treeViewSize = 150;

        // regex to split lines intto columns
        const splitre = /[\t;]+/

        const parseHeaders = function (tsv) {
            const lines = tsv.split("\n");
            let headers = [];
            let sample = lines[1] ? lines[1].split(splitre) : [];

            if (lines[0].startsWith("#")) {
                let parts = lines[0].substring(1).split(splitre);
                parts.forEach((p, j) => {
                    headers.push({
                        label: p.trim(),
                        isNumeric: !isNaN(sample[j])
                    })
                })
            } else {
                const N = lines[0].split(splitre).length;
                for (let i = 1; i <= N; i++) {
                    headers.push({
                        label: `Column ${i}`,
                        isNumeric: !isNaN(sample[i])
                    })
                }
            }
            return headers;
        }

        const parseData = function (tsv, headers, rowLb, colLb) {
            // non-distinct labels

            let rowIdx = headers.map(h => h.label).indexOf(rowLb);
            //headers.indexOf(rowLb);
            rowIdx = rowIdx >= 0 ? rowIdx : 0;
            let rowLbs = [];
            let colIdx = headers.map(h => h.label).indexOf(colLb);//headers.indexOf(colLb);
            colIdx = colIdx >= 0 ? colIdx : 1;
            let colLbs = [];

            const lines = tsv.split("\n");
            if (lines[0].startsWith("#")) {
                // remove headers line
                lines.shift();
            }

            let m = [];

            lines.forEach((l, i) => {
                const p = l.split(splitre)

                let row = {};
                headers.forEach((h, j) => row[h.label] = p[j].trim())
                m.push(row)

                rowLbs.push(p[rowIdx].trim())
                colLbs.push(p[colIdx].trim())
            });

            return {
                matrix: m,
                headers: headers,
                rowLabels: [...new Set(rowLbs)],
                colLabels: [...new Set(colLbs)],
            };
        }

        const create2Darray = function (r, c, filler) {
            let res = []
            for (let i = 0; i < r; i++) {
                let a = new Array(c);
                a.fill(filler, 0, c);
                res.push(a);
            }
            return res;
        }

        /**
         * convert pairwise to rect matrix using propname
         * Input is an array of objects {}
         * @param {*} rawdata 
         * @param {String} rowname - name of the column to use as matrix row label
         * @param {String} colname - name of the column to use as matrix column label
         * @param {String} propname - name of the column to use as data value
         * @param {String} duplicatesMode - one of []first, last, min, max
         */
        const getValueMatrix = function (rawdata, rowname, colname, propname, duplicatesMode = "first") {
            // matrix dimensions
            const nrows = rawdata.rowLabels.length;
            const ncols = rawdata.colLabels.length;


            // init matrix for rows clustering, fill with 0s    
            let mxrows = create2Darray(nrows, ncols, 0)

            // init matrix for column clustering, fill with 0s    
            let mxcols = create2Darray(ncols, nrows, 0);
            // for (let i = 0; i < ncols; i++) {
            //     let a = new Array(ncrows);
            //     a.fill(0, 0, nrows - - 1);
            //     mxcols.push(a);
            // }

            let links = [];
            let min = +rawdata.matrix[0][propname];
            let max = min;
            rawdata.matrix.forEach(pair => {
                let r = rawdata.rowLabels.indexOf(pair[rowname])
                let c = rawdata.colLabels.indexOf(pair[colname])
                let v = +pair[propname];
                // check if pair was seen before
                if (mxrows[r][c] != null && mxrows[r][c] != 0) {
                    switch (duplicatesMode) {
                        case "first": v = mxrows[r][c]; break;
                        case "last": v = v; break;
                        case "min": v = Math.min(v, mxrows[r][c]); break;
                        case "max": v = Math.max(v, mxrows[r][c]); break;
                        default: v = mxrows[r][c]; break;
                    }
                }
                mxrows[r][c] = v;
                mxcols[c][r] = v;
                min = Math.min(min, v);
                max = Math.max(max, v);

                links.push({ source: r, target: c, value: v });
            })

            return { rowMatrix: mxrows, colMatrix: mxcols, links: links, extent: [min, max] };
        }

        /**
         * Performs hierarchical clustering and ordering of elements.
         * Returns tree and array of elements' indices in original data
         * @param {type} data - 2d matrix with values
         * @param {Array|size} size
         * @return {Array|DendroHeatmap.prototype.hcluster.order}
         */
        const hcluster = function (data) {
            // clusterfck needs 2d array of values

            function children(d) {
                let l = d.left || null,
                    r = d.right || null,
                    res = [];
                l && res.push(l);
                r && res.push(r);

                if (res.length > 0) {
                    return res;
                }
                return null;
            }


            let clusters = clusterfck.hcluster(data);
            let tree = d3.hierarchy(clusters[0], children);


            const h = cellSize * data.length;
            const w = treeViewSize;
            let tree1 = d3.cluster().size([h, w]);
            tree1(tree);

            // now leaves are ordered by cluster id
            let leaves = tree.leaves();

            // will keep index of element in original data here
            let order = [];

            leaves.forEach(function (leaf) {
                let d = leaf.data.canonical; // original row from matrix
                let i = data.indexOf(d);
                order.push(i);
            });
            console.log('Data clustered (hierarchical)');

            return { tree: tree, order: order };
        };

        const clusterKmeans = function (data, numClusters) {
            let clusters = d3.kmeans(data, numClusters, function (d) {
                return d.value;
            });
            // assing group values for each data element
            let result = new Array();

            clusters.forEach(function (group, g) {
                group.forEach(function (d, i) {
                    d.group = g + 1;
                });

                result = result.concat(group);
            });
            console.log('Data clustered (k-means).');
            return result;
        };


        /**
         * Reorderx matrix according to clustering order
         * For 1d array use reorderMatrix(array, [0], colOrder)
         * @param {*} matrix - original matrix
         * @param {*} rowOrder - order of rows in the new matrix
         * @param {*} colOrder - order of columns in the new matrix
         */
        const reorderMatrix = function (matrix, rowOrder, colOrder) {
            let res = create2Darray(matrix.length, matrix[0].length, 0);
            rowOrder.forEach((row, r) => { // original row number and new index
                colOrder.forEach((col, c) => { //oricinal column number and new index
                    res[r][c] = matrix[row][col]
                })
            });
            return res;
        }
        /**
        * Reorder array according to clustering order
        * @param {*} arr - original arr
        * @param {*} order - order of rows in the new matrix
        */
        const reorderArray = function (arr, order) {
            let res = new Array(arr.length)
            order.forEach((col, c) => { //oricinal column number and new index
                res[c] = arr[col]
            })

            return res;
        }

        /**
         * Actual drawig function
         * @param {*} orderedMatrix 
         * @param {*} rowsTree 
         * @param {*} colsTree 
         * @param {*} rowsLabels 
         * @param {*} colsLabels 
         */
        const heatmapDendro = function (orderedMatrix, rowsTree, colsTree, rowsLabels, colsLabels, colorScale) {

            d3.select(parent)//.attr("style", "overflow: scroll;");
            d3.select(parent).selectAll(".dendrocanvas").remove();

            let canvas = d3.select(parent).append("div")
                .style("overflow", "scroll")
                .attr("class", "dendrocanvas")
            let svg = canvas
                .append("svg")
                .attr("width", "100%")
                .attr("height", "150px");

            let height = 150 - margin.top - margin.bottom;

            const colNumber = orderedMatrix[0].length;
            const rowNumber = orderedMatrix.length;

            let clusterSpace = treeViewSize, // size of the cluster tree
                width = cellSize * colNumber + clusterSpace, // - margin.left - margin.right,
                // rowCluster = d3.cluster().size([height - clusterSpace, clusterSpace]),
                // colCluster = d3.cluster().size([width - clusterSpace, clusterSpace]),
                rowNodes = rowsTree.descendants(),
                colNodes = colsTree.descendants();
            height = cellSize * rowNumber + clusterSpace; // - margin.top - margin.bottom


            let matrix = [];
            for (let r = 0; r < rowNumber; r++) {
                for (let c = 0; c < colNumber; c++) {
                    matrix.push({ row: r + 1, col: c + 1, value: orderedMatrix[r][c] });
                }
            }


            svg.selectAll("*").remove();

            svg.attr("width", width + margin.left + margin.right + clusterSpace)
                .attr("height", height + margin.top + margin.bottom + clusterSpace);

            let rowLabels = svg.append("g")
                .selectAll(".rowLabelg")
                .data(rowsLabels)
                .enter()
                .append("text")
                .text(function (d) {
                    return d;
                })
                .attr("x", 0)
                .attr("y", function (d, i) {
                    return (i + 1) * cellSize + clusterSpace;
                })
                .style("text-anchor", "start")
                .attr("transform", "translate(" + (width + cellSize) + "," + cellSize / 1.5 + ") ")
                .attr("class", function (d, i) {
                    return "rowLabel mono r" + i;
                });

            let colLabels = svg.append("g")
                .selectAll(".colLabelg")
                .data(colsLabels)
                .enter()
                .append("text")
                .text(function (d) {
                    return d;
                })
                .attr("x", 0)
                .attr("y", function (d, i) {
                    return (i + 1) * cellSize;
                })
                .style("text-anchor", "end")
                .attr("transform", "translate(" + cellSize / 2 + ",-6) rotate (-90)  translate( -" + (height + cellSize * 2) + "," + clusterSpace + ")")
                .attr("class", function (d, i) {
                    return "colLabel mono c" + i;
                });

            let heatMap = svg.append("g").attr("class", "g3")
                .selectAll(".cellg")
                .data(matrix, function (d) {
                    return d.row + ":" + d.col;
                })
                .enter()
                .append("rect")
                .attr("x", function (d) {
                    return d.col * cellSize + clusterSpace;
                })
                .attr("y", function (d) {
                    return d.row * cellSize + clusterSpace;
                })
                .attr("class", function (d) {
                    return "cell cell-border cr" + (d.row - 1) + " cc" + (d.col - 1);
                })
                .attr("width", cellSize)
                .attr("height", cellSize)
                .style("fill", function (d) {
                    return colorScale(d.value);
                })
                .on("mouseover", function (event, d) {
                    d3.select(this).classed("cell-hover", true);
                    //Update the tooltip position and value
                    d3.select("#d3tooltip")
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px")
                        .select("#tooltipvalue")
                        .html(
                            "Column: " + colsLabels[d.col - 1] + "<br>Row: " + rowsLabels[d.row - 1]
                            + "<br>Value: " + d.value
                        );
                    //Show the tooltip
                    d3.select("#d3tooltip").transition()
                        .duration(200)
                        .style("opacity", .9);
                })
                .on("mouseout", function () {
                    d3.select(this).classed("cell-hover", false);
                    d3.selectAll(".rowLabel").classed("text-highlight", false);
                    d3.selectAll(".colLabel").classed("text-highlight", false);
                    d3.select("#d3tooltip").transition()
                        .duration(200)
                        .style("opacity", 0);
                })
                ;

            //tree for rows
            let rTree = svg.append("g").attr("class", "rtree").attr("transform", "translate (10, " + (clusterSpace + cellSize) + ")");
            let rlink = rTree.selectAll(".rlink")
                .data(rowsTree.links())
                .enter().append("path")
                .attr("class", "rlink")
                // .attr("stroke", "#888")
                .attr("d", elbow);

            let rnode = rTree.selectAll(".rnode")
                .data(rowNodes)
                .enter().append("g")
                .attr("class", "rnode")
                .attr("transform", function (d) {
                    return "translate(" + d.y + "," + d.x + ")";
                });

            //tree for cols
            let cTree = svg.append("g").attr("class", "ctree").attr("transform", "rotate (90), translate (10, -" + (clusterSpace + cellSize) + ") scale(1,-1)");
            let clink = cTree.selectAll(".clink")
                .data(colsTree.links())
                .enter().append("path")
                .attr("class", "clink")
                // .attr("stroke", "#888")
                .attr("d", elbow);

            let cnode = cTree.selectAll(".cnode")
                .data(colNodes)
                .enter().append("g")
                .attr("class", "cnode")
                .attr("transform", function (d) {
                    return "translate(" + d.y + "," + d.x + ")";
                });

            function elbow(d, i) {
                return "M" + d.source.y + "," + d.source.x
                    + "V" + d.target.x + "H" + d.target.y;
            }
        }

        const clusterByAndDisplay = function (data, rowname, colname, propname, colorschema, duplicatesMode) {

            // get data using accessor
            let valueMatrix = getValueMatrix(data, rowname, colname, propname, duplicatesMode)
            // let matrix = valueMatrix.matrix;

            // TODO: add UI to change this
            let cs = colorschema ? colorschema : d3.interpolateRdYlGn;
            let colorScale = d3.scaleSequential(valueMatrix.extent, cs);

            // const numClusters = 3;
            // let links = this.clusterKmeans(links, numClusters);


            // cluster rows and columns
            let rowClusters = hcluster(valueMatrix.rowMatrix);
            console.log(rowClusters)

            let colClusters = hcluster(valueMatrix.colMatrix);
            console.log(colClusters)

            let orderedMatrix = reorderMatrix(valueMatrix.rowMatrix, rowClusters.order, colClusters.order)
            let rowsLabels = reorderArray(data.rowLabels, rowClusters.order)
            let colsLabels = reorderArray(data.colLabels, colClusters.order)

            heatmapDendro(orderedMatrix, rowClusters.tree, colClusters.tree, rowsLabels, colsLabels, colorScale)
        }

        const initControls = function (headers) {
            if (d3.selectAll("#d3tooltip").empty()) {
                d3.select("body")
                    .append("div")
                    .attr("id", "d3tooltip")
                    .append("p")
                    .attr("id", "tooltipvalue")
            }

            // prompt for row and col labels:
            let controls = d3.select(parent).append('div').attr("class", "dendrocontrols grid-container");

            // rows controls
            let rowsCtl = controls.append("div");
            rowsCtl.append("div").html("Matrix row labels")
            let rowLabelInput = rowsCtl
                .append("select").attr("id", "rowLabelSelect");

            rowLabelInput.selectAll("option")
                .data(headers)
                .enter()
                .append("option")
                .attr("value", function (d) {
                    return d.label;
                })
                .text(function (d) {
                    return d.label;
                });

            // cols controls
            let colsCtl = controls.append("div");
            colsCtl.append("div").html("Matrix column labels (numeric only)")
            let colLabelInput = colsCtl
                .append("select").attr("id", "colLabelSelect");

            colLabelInput.selectAll("option")
                .data(headers)
                .enter()
                .append("option")
                .attr("value", function (d) {
                    return d.label;
                })
                .text(function (d) {
                    return d.label;
                });

            // cluster controls
            let clusterCtl = controls.append("div");
            clusterCtl.append("div").html("Matrix data")
            let clusterLabelInput = clusterCtl
                .append("select").attr("id", "clusterLabelSelect");

            clusterLabelInput.selectAll("option")
                .data(headers.filter(h => h.isNumeric))
                .enter()
                .append("option")
                .attr("value", function (d) {
                    return d.label;
                })
                .text(function (d) {
                    return d.label;
                });

            // duplicate mode
            const dupModes = [
                { label: "Keep first", value: "first" },
                { label: "Keep last", value: "last" },
                { label: "Keep min", value: "min" },
                { label: "Keep max", value: "max" }
            ];

            let duplCtl = controls.append("div");
            duplCtl.append("div").html("Duplicates mode")
            let duplicatesModeInput = duplCtl
                .append("select").attr("id", "duplSelect");
            duplicatesModeInput.selectAll("option")
                .data(dupModes)
                .enter()
                .append("option")
                .attr("value", function (d) {
                    return d.value;
                })
                .text(function (d) {
                    return d.label;
                });



            // coloring // cluster controls
            let colorCtl = controls.append("div");
            colorCtl.append("div").html("Coloring")
            let colorLabelInput = colorCtl
                .append("select").attr("id", "colorSelect");

            const colorSchemas = [

                { label: "Red -> Yellow -> Green", value: d3.interpolateRdYlGn },
                { label: "Brown -> BlueGreen", value: d3.interpolateBrBG },
                { label: "Purple -> Green", value: d3.interpolatePRGn },
                { label: "Pinkk -> YellowGreen", value: d3.interpolatePiYG },
                { label: "Purple -> Orange", value: d3.interpolatePuOr },

                { label: "Red -> Blue", value: d3.interpolateRdBu },
                { label: "Red -> Yellow -> Blue", value: d3.interpolateRdYlBu },
                { label: "Spectral", value: d3.interpolateSpectral },

                //single color
                { label: "Blue", value: d3.interpolateBlues },
                { label: "Green", value: d3.interpolateGreens },
                { label: "Gray", value: d3.interpolateGreys },
                { label: "Orange", value: d3.interpolateOranges },
                { label: "Purple", value: d3.interpolatePurples },
                { label: "Red", value: d3.interpolateReds },

                // Multi-Hue    
                { label: "Turbo", value: d3.interpolateTurbo },
                { label: "Viridis", value: d3.interpolateViridis },
                { label: "Inferno", value: d3.interpolateInferno },
                { label: "Magma", value: d3.interpolateMagma },
                { label: "Plasma", value: d3.interpolatePlasma },
                { label: "Cividis", value: d3.interpolateCividis },


                { label: "Warm", value: d3.interpolateWarm },
                { label: "Cool", value: d3.interpolateCool },
                { label: "Cubehelix", value: d3.interpolateCubehelixDefault },


                { label: "BlueGreen", value: d3.interpolateBuGn },
                { label: "BluePurple", value: d3.interpolateBuPu },
                { label: "GreenBlue", value: d3.interpolateGnBu },


                { label: "OrangeRed", value: d3.interpolateOrRd },
                { label: "PurpleBlueGreen", value: d3.interpolatePuBuGn },
                { label: "PurpleBlue", value: d3.interpolatePuBu },


                { label: "PurpleRed", value: d3.interpolatePuRd },
                { label: "RedPurple", value: d3.interpolateRdPu },

                { label: "YellowGreen", value: d3.interpolateYlGn },


                { label: "YellowGreenBlue", value: d3.interpolateYlGnBu },
                { label: "YellowOrangeBrown", value: d3.interpolateYlOrBr },

                { label: "YellowOrangeRed", value: d3.interpolateYlOrRd },

            ]

            let legend;
            let colorSvg;
            let defs;
            let stops = [0, 25, 50, 75, 100];
            if (colorCtl.select("svg").empty()) {
                colorSvg = colorCtl.append("svg")
                    .attr("width", 150)
                    .attr("height", 20)
                defs = colorSvg.append("defs");
            }

            colorLabelInput.selectAll("option")
                .data(colorSchemas)
                .enter()
                .append("option")
                .attr("value", function (d, i) {
                    return i;
                })
                .text(function (d) {
                    return d.label;
                });

            colorLabelInput.on("change", function () {
                colorSvg.selectAll("linearGradient").remove();

                //Append a linearGradient element to the defs and give it a unique id
                let linearGradient = defs.append("linearGradient")
                    .attr("id", "linear-gradient");
                //Horizontal gradient
                linearGradient
                    .attr("x1", "0%")
                    .attr("y1", "0%")
                    .attr("x2", "100%")
                    .attr("y2", "0%");

                legend = colorSvg.append("rect")
                    .attr("width", 150)
                    .attr("height", 20)
                let colorScale = d3.scaleSequential([0, 100], colorSchemas[this.value].value)

                //Append multiple color stops by using D3's data/enter step
                linearGradient.selectAll("stop")
                    .data(stops)
                    .enter().append("stop")
                    .attr("offset", function (d) { return `${d}%` })
                    .attr("stop-color", function (d) { return colorScale(d); });

                legend.style("fill", "url(#linear-gradient)");
            })

            let errorrDiv = controls.append("div").attr("style", "color:red");

            controls.append("button")
                .attr("id", "displayButton")
                .text("DISPLAY")
                .on("click", function () {
                    errorrDiv.html("");
                    let rowLb = rowLabelInput.node().value;
                    let colLb = colLabelInput.node().value;
                    let clsLb = clusterLabelInput.node().value;
                    let duplLb = duplicatesModeInput.node().value;

                    if (rowLb === colLb || colLb === clsLb || rowLb === clsLb) {
                        errorrDiv.html("Selected values should be different")
                    }
                    else {
                        let colr = colorSchemas[colorLabelInput.node().value].value;
                        let data = parseData(textdata, headers, rowLb, colLb, clsLb);
                        console.log(data)
                        console.log(`Parsed [${data.rowLabels.length} x ${data.colLabels.length}] matrix
                        with ${data.headers.length - 2} value sets`);

                        clusterByAndDisplay(data, rowLb, colLb, clsLb, colr, duplLb)
                    }

                })

        }

        let headers = parseHeaders(textdata)
        initControls(headers);

        // clusterByAndDisplay(data, 'pident')
        // draw(data)
    }

})();