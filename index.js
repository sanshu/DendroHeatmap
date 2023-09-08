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

        // prompt for row and col labels:
        const topControls = d3.select(parent).append('div')
            .attr("class", "grid-container");

        const wrapper = d3.select(parent).append("div")
            .attr("class", "dendro-wrapper");

        const dendroControls = wrapper.append('div')
            .attr("class", "dendro-controls").property("hidden", true);

        const dendroCanvas = wrapper.append("div")
            .style("overflow", "scroll")
            .attr("class", "dendro-canvas")

        const emptyMsgDiv = dendroCanvas.append("div").html("Nothing to display yet.");

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


        let valueMatrix; // global var containing preparsedfiltered data


        //matrix cell size
        const cellSize = 12;
        // space between cells in map
        const cellGap = 2;
        // total width of the cell
        const cellWidth = cellSize + cellGap;
        // depth of the panel with the tree
        const treeViewSize = 200;
        // space between trees and map
        const heatmapMargin = 3;

        // value to indicate missing data poin
        const noValue = -123456;
        // color to show when data is missing
        const noValueColor = "#BBB";

        // init canvas
        dendroCanvas.selectAll("*").remove();
        let svg = dendroCanvas.append("svg")
            .attr("width", "100%")
            .attr("height", "150px");

        // regex to split lines into columns
        const splitre = /[\t;]+/

        /**
         * Input tata should contain at least 3 columns
         * @param {string} tsv - input data in tsv format
         * @returns array of string to be used as data headers
         */
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


        /**
         * Parses input data
         * @param {String} tsv - input data in tsv format
         * @param {String[]} headers - list of available headers for data
         * @param {String} rowLb - name of the column with row labels
         * @param {String} colLb - name of the column with coklumn labels
         * @returns parsed data
         */
        const parseData = function (tsv, headers, rowLb, colLb) {

            let rowIdx = headers.map(h => h.label).indexOf(rowLb);
            rowIdx = rowIdx >= 0 ? rowIdx : 0; //use first colums by default
            let rowLbs = [];
            let colIdx = headers.map(h => h.label).indexOf(colLb);
            colIdx = colIdx >= 0 ? colIdx : 1;  //use second colums by default
            let colLbs = [];

            const lines = tsv.split("\n");
            if (lines[0].startsWith("#")) {
                // remove headers line
                lines.shift();
            }

            let m = [];

            lines.forEach((l, i) => {
                if (!l.startsWith("#")) {
                    const p = l.split(splitre);

                    let row = {};
                    headers.forEach((h, j) => row[h.label] = p[j].trim());
                    m.push(row);

                    rowLbs.push(p[rowIdx].trim());
                    colLbs.push(p[colIdx].trim());
                }
            });

            return {
                matrix: m,
                headers: headers,
                rowLabels: [...new Set(rowLbs)],
                colLabels: [...new Set(colLbs)],
            };
        }

        /**
         * Create and fill matrix with given dimansions
         * @param {number} r - number of rows
         * @param {number} c - number of columns
         * @param {*} filler - value ot fill the matrix
         * @returns matrix 
         */
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
         * Check if data row satisfies all filters
         * @param {} row 
         * @param {*} filters 
         * @returns boolean
         */
        const okFilter = function (row, filters) {
            let res = true;

            for (const [k, f] of Object.entries(filters)) {
                let v = +row[k];

                if (v != null && !isNaN(v)) {
                    switch (f.mode) {
                        case ">": res = res && (v > f.value); break;
                        case ">=": res = res && (v >= f.value); break;
                        case "<": res = res && (v < f.value); break;
                        case "<=": res = res && (v <= f.value); break;
                        case "--": res = res && true; break; // no filter
                        default: res = res && true; // unknown filter
                    }
                } else {
                    res = res && true;
                }
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
        const getValueMatrix = function (rawdata, rowname, colname, propname, duplicatesMode = "first", filters = {}) {
            // matrix dimensions
            const nrows = rawdata.rowLabels.length;
            const ncols = rawdata.colLabels.length;

            // init matrix for rows clustering, fill with 0s    
            let mxrows = create2Darray(nrows, ncols, noValue)

            // init matrix for column clustering, fill with 0s    
            let mxcols = create2Darray(ncols, nrows, noValue);


            let links = [];
            let min = +rawdata.matrix[0][propname];
            let max = min;
            rawdata.matrix.forEach(pair => {
                let r = rawdata.rowLabels.indexOf(pair[rowname])
                let c = rawdata.colLabels.indexOf(pair[colname])
                let v = +pair[propname];

                // apply filters
                if (okFilter(pair, filters)) {

                    // check if pair was seen before
                    if (mxrows[r][c] != null && mxrows[r][c] != noValue) {
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
                }
            })

            return { rowMatrix: mxrows, colMatrix: mxcols, links: links, extent: [min, max] };
        }

        const initSvgElements = function () {
            let rowLabels = svg.append("g").attr("id", "rowLabels")
            let colLabels = svg.append("g").attr("id", "columnLabels");
            let heatMap = svg.append("g").attr("class", "g3").attr("id", "heatmap");
            let rtree = svg.append("g").attr("id", "rtree").attr("class", "rtree");
            let ctree = svg.append("g").attr("id", "ctree").attr("class", "ctree");
        }
        const layoutTree = function (data, tree) {

            const h = (cellSize + cellGap) * tree.leaves().length + cellGap;
            const w = treeViewSize;

            const treeSeparation = function (a, b) {
                return cellSize + cellGap;
            }

            let tree1 = d3.cluster().size([h, w]).separation(treeSeparation);
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

            return { tree: tree, order: order };
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
            console.log('Data clustered (hierarchical)');
            return layoutTree(data, tree)
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
         * Reorder matrix according to clustering order
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
            let res = new Array(order.length)
            order.forEach((col, c) => { //original column number and new index
                res[c] = arr[col]
            });

            return res;
        }

        /**
         * Averages over two arrays. If one of the values is =noVlues result will have the same.
         * In one of the arrays shotret that annother averaged value is set tot noValue
         * @param {*} a first array
         * @param {*} b second array
         * @returns averaged array
         */
        const averageArray = function (a, b) {
            let L = Math.max(a.length, b.length);
            let res = [];
            for (let i = 0; i < L; i++) {
                let va = a[i] === null ? noValue : a[i];
                let vb = b[i] === null ? noValue : b[i];
                let v = (va === noValue || vb === noValue) ? noValue : (va + vb) / 2;
                res.push(v)
            }
            return res;
        }


        /**
         * Create reordered field for every node, accordign to the order
         * @param {*} clusters - clustered tree from hcluster() call
         * @param {*} order - array on indexes in original data set
         * @param {*} origLabels - nnode labels in original order
         */
        const reorderTreeData = function (clusters, order, origLabels) {
            const tree = clusters.tree;
            let labels = reorderArray(origLabels, clusters.order);

            //loop over all tree nodes (non-leaves included)
            tree.descendants().forEach((d, i) => {
                d.data.id = i;
                d.data.collapsed = false;
                if (d.children) {
                    let avg = averageArray(d.children[0].data.canonical, d.children[1].data.canonical);
                    d.data.ordered = reorderArray(avg, order);
                }
                else
                    d.data.ordered = reorderArray(d.data.canonical, order);
            })
            tree.leaves().forEach((d, i) => {
                d.data.label = labels[i]
                d.data.originalIndex = origLabels.indexOf(labels[i])
            })
        }

        /**
         * 
         * @param {Tree node mouse over} node 
         * @param {*} event 
         * @param {*} order 
         * @param {*} d 
         * @param {*} isRow 
         */
        const nodeMouseOver = function (node, order, event, d, isRow) {
            node.classed("node-hover", true)
                .attr("r", function (d, i) {
                    return d.children ? 6 : 2
                });
            console.log(d);

            const prefix = isRow ? "cr" : "cc";
            const lblPrefix = isRow ? "r" : "c";
            const leaves = d.leaves();
            leaves.forEach(l => {
                // const idx = l.data.originalIndex;//matrix.indexOf(l.data.canonical); // original idx row from matrix
                const idx2 = l.data.id;//order.indexOf(idx) - 1;
                if (idx2 >= -1) {
                    d3.selectAll(`.${prefix}${idx2}`).classed("cell-hover", true);
                    d3.selectAll(`.${lblPrefix}${idx2}`).classed("text-highlight", true)
                }
            })
        }

        const nodeClicked = function (node, rowClusters, colClusters, event, d, isRow, colorScale) {
            // do ot collapse root node
            if (!d.parent) return;
            d.data.collapsed = !d.data.collapsed
            node.classed("node-collapsed", d.data.collapsed)

            if (d.children) {
                d._children = d.children;
                d.children = null;
            } else {
                d.children = d._children;
                d._children = null;
            }

            if (d.data.collapsed) {
                d.data._label = d.data.label;
                d.data.label = "[collapsed]";
            } else {
                d.data.label = d.data._label;
            }

            let data = isRow ? valueMatrix.rowMatrix : valueMatrix.colMatrix;
            let tree = isRow ? rowClusters.tree : colClusters.tree;
            let newLayout = layoutTree(data, tree);

            if (isRow)
                heatmapDendro(newLayout, colClusters, colorScale);
            else {
                // need to reorder heatmap data for rows, extracted from reorderTreeData()
                rowClusters.tree.descendants().forEach((d, i) => {
                    if (d.children) {
                        let avg = averageArray(d.children[0].data.canonical, d.children[1].data.canonical);
                        d.data.ordered = reorderArray(avg, newLayout.order);
                    }
                    else
                        d.data.ordered = reorderArray(d.data.canonical, newLayout.order);
                })
                heatmapDendro(rowClusters, newLayout, colorScale);
            }
        }

        /**
         * Tree node mouse out
         * @param {*} node 
         * @param {*} event 
         * @param {*} isRow 
         */
        const nodeMouseOut = function (node, event, isRow) {
            node.classed("node-hover", false)
                .attr("r", function (d) {
                    return d.children ? 2 : 1
                });
            d3.selectAll(".cell").classed("cell-hover", false);
            const cl = isRow ? ".rowLabel" : ".colLabel";

            d3.selectAll(cl).classed("text-highlight", false)
        }

        /**
         * 
         * @param {*} rowClusters Clustered data for rows
         * @param {*} colClusters Clustered data for columns
         * @param {*} colorScale  Coloring function
         */
        const heatmapDendro = function (rowClusters, colClusters, colorScale) {
            const rowsTree = rowClusters.tree;
            const colsTree = colClusters.tree;

            const rows = rowClusters.tree.leaves();
            const cols = colsTree.leaves();

            const colNumber = cols.length;
            const rowNumber = rows.length;

            const duration = 500;
            const tranz = svg.transition().duration(duration);

            let treeWidth = treeViewSize + heatmapMargin, // size of the cluster tree
                width = cellWidth * colNumber + treeWidth, //size of the view
                height = cellWidth * rowNumber + treeWidth;

            // keep for now, move to data.enter later    
            let matrix = [];
            rows.forEach((l, r) => {
                l.data.ordered.forEach((v, c) =>
                    matrix.push({
                        row: r + 1, col: c + 1, value: v,
                        rdata: rows[r].data,
                        cdata: cols[c].data
                    })
                )
            })

            svg.attr("width", width + margin.left + margin.right + treeWidth)
                .attr("height", height + margin.top + margin.bottom + treeWidth);

            const ithCell = function (d, i) {
                return (i + 1) * cellWidth;
            }

            const rowLabelsG = svg.select("#rowLabels");
            rowLabelsG.attr("transform", "translate(" + (width + cellSize) + "," + (treeWidth + cellSize / 1.5) + ") ");

            const rowLabelsUpdate = rowLabelsG.selectAll("text")
                .data(rows, d => d)
                .attr("class", "rowLabelg")
                .text(d => d.data.label)
                .call(update => update.transition(tranz)
                    .attr("y", ithCell)
                )
                .attr("class", function (d, i) {
                    return "rowLabel mono r" + d.data.id;
                });

            const rowLabelsEnter = rowLabelsUpdate.enter().append("text")
                .text(d => d.data.label)
                .attr("x", 0)
                .call(update => update.transition(tranz)
                    .attr("y", ithCell)
                )
                .style("text-anchor", "start")
                .attr("class", function (d, i) {
                    return "rowLabel mono r" + d.data.id;
                });

            const rowLabelsExit = rowLabelsUpdate.exit()
                .call(exit => exit.transition(tranz)
                    .attr("opacity", 0)
                    .remove());

            const colLabelsG = svg.select("#columnLabels");
            colLabelsG.attr("transform", "translate(" + cellWidth / 2 + ",-6) rotate (-90)  translate( -" + (height + cellWidth * 2) + "," + treeWidth + ")")

            const colLabelsUpdate = colLabelsG.selectAll("text")
                .data(cols, d => d.data.label)
                .attr("class", ".colLabelg")
                .attr("class", function (d, i) {
                    return "colLabel mono c" + d.data.id;
                })
                .call(update => update.transition(tranz)
                    .attr("y", ithCell)
                );

            const colLabelsEnter = colLabelsUpdate.enter().append("text")
                .attr("class", ".colLabelg")
                .style("text-anchor", "end")
                .attr("x", 0)
                .text(d => d.data.label)
                .attr("y", function (d, i) {
                    return (i + 1) * cellWidth;
                })
                .attr("class", function (d, i) {
                    return "colLabel mono c" + d.data.id;
                })
                .call(enter => enter.transition(tranz)
                    .attr("y", function (d, i) {
                        return (i + 1) * cellWidth;
                    }).attr("opacity", 1)
                );

            const colLabelsExit = colLabelsUpdate.exit()
                .call(exit => exit.transition(tranz)
                    .attr("opacity", 0)
                    .remove());


            // Apply to whole heatmap to avoid calculating it for each x and y attribute    
            const shift = -.5 * cellGap + treeWidth;//+ cellWidth;
            let heatMap = svg.select("#heatmap");
            if (heatMap.empty())
                svg.append("g").attr("class", "g3").attr("id", "heatmap");
            heatMap.attr("transform", "translate(" + shift + "," + shift + ")");

            const cellMouseOver = function (event, d) {
                d3.select(this).classed("cell-hover", true);
                //Update the tooltip position and value

                let tooltipContent = "Column: " + d.cdata.label +
                    "<br>Row: " + d.rdata.label
                    + "<br>Value: " + (d.value === noValue ? "N/A" : d.value)

                d3.select("#d3tooltip")
                    .style("left", (event.pageX - 210) + "px")
                    .style("top", (event.pageY - 80) + "px")
                    .select("#tooltipvalue")
                    .html(tooltipContent);
                //Show the tooltip
                d3.select("#d3tooltip").transition()
                    .duration(200)
                    .style("opacity", .9);

                d3.selectAll(`.r${d.rdata.id}`).classed("text-highlight", true);
                d3.selectAll(`.c${d.cdata.id}`).classed("text-highlight", true);
            }

            const cellMouseOut = function (event, d) {
                d3.select(this).classed("cell-hover", false);
                d3.selectAll(".rowLabel").classed("text-highlight", false);
                d3.selectAll(".colLabel").classed("text-highlight", false);
                d3.select("#d3tooltip").transition()
                    .duration(200)
                    .style("opacity", 0);
            }
            /*
                        // rows in the heatmap   
                        const rowsUpdate = heatMap.selectAll("g")
                            .data(rows)
                            .attr("class", function (d, i) {
                                return `rowgroup rowgroup_${i}`
                            })
                            .attr("transform",function (d, i) { return "translate(0," +  (i * cellWidth) + ")";})
                            // .attr("x", 0)
                            // .attr("y", function (d, i) {
                            //     return i * cellWidth;
                            // });
            
                        const rowsExit = rowsUpdate.exit()
                            .call(exit => exit.transition(tranz)
                                .attr("opacity", 0)
                                .attr("height", 0)
                                .remove());
            
            
                        const rowsEnter = rowsUpdate.enter().append("g")
                            .attr("class", function (d, i) {
                                return `rowgroup rowgroup_${i}`
                            }).attr("id", function (d, i) {
                                return `row-${i}`
                            })
                            .attr("transform",function (d, i) { return "translate(0," +  (i * cellWidth) + ")";})
            
                        ///cells in the row    
                        const cellsUpdate = rowsUpdate.selectAll("g")
                            .data(function (d) {
                                 return d.data.ordered; 
                                })
                            // .attr("class", "cellg")
                            .attr("x", function (d, i) {
                                return i * cellWidth;
                            })
                            .attr("y", function (d) {
                                return 0;
                            })
                            .attr("class", function (d, i) {
                                return "cell cell-border cc" + (i - 1);
                            })
                            .style("fill", function (d) {
                                return (d === noValue) ? noValueColor : colorScale(d);
                            });
            
                        const cellsEnter = cellsUpdate.enter().append("rect")
                            .attr("class", "cellg")
                            .attr("x", function (d, i) {
                                return i * cellWidth;
                            })
                            .attr("y", function (d) {
                                return 0;//d.row * cellWidth;
                            })
                            .attr("class", function (d, i) {
                                return "cell cell-border  cc" + (i - 1);
                            })
                            .attr("width", cellSize)
                            .attr("height", cellSize)
                            .style("fill", function (d) {
                                return (d === noValue) ? noValueColor : colorScale(d);
                            })
                            .on("mouseover", cellMouseOver)
                            .on("mouseout", cellMouseOut);
            
                        const cellsExit = cellsUpdate.exit()
                            .call(exit => exit.transition(tranz)
                                .attr("opacity", 0)
                                .attr("height", 0)
                                .remove());
            
            */
            const cellsUpdate = heatMap.selectAll("rect")
                .data(matrix, function (d) {
                    return d.row + ":" + d.col;
                })
                .attr("class", "cellg")
                .attr("x", function (d) {
                    return d.col * cellWidth;
                })
                .attr("y", function (d) {
                    return d.row * cellWidth;
                })
                .attr("class", function (d) {
                    return "cell cell-border cr" + (d.rdata.id) + " cc" + (d.cdata.id);
                })
                .style("fill", function (d) {
                    return (d.value === noValue) ? noValueColor : colorScale(d.value);
                });

            const cellsEnter = cellsUpdate.enter().append("rect")
                .attr("class", "cellg")
                .attr("x", function (d) {
                    return d.col * cellWidth;
                })
                .attr("y", function (d) {
                    return d.row * cellWidth;
                })
                .attr("class", function (d) {
                    return "cell cell-border cr" + (d.rdata.id) + " cc" + (d.cdata.id);
                })
                .attr("width", cellSize)
                .attr("height", cellSize)
                .style("fill", function (d) {
                    return (d.value === noValue) ? noValueColor : colorScale(d.value);
                })
                .on("mouseover", cellMouseOver)
                .on("mouseout", cellMouseOut);

            const cellsExit = cellsUpdate.exit()
                .call(exit => exit.transition(tranz)
                    .attr("opacity", 0)
                    .attr("height", 0)
                    .remove());


            const drawTree = function (treeGroup, tree, isRow) {
                // branches    
                const rLinkUpdate = treeGroup.selectAll(".treelink")
                    .data(tree.links(), d => d.source.data.id)
                    .attr("fill", "none")
                    .attr("d", elbow);

                const rLinkEnter = rLinkUpdate.enter().append("path")
                    .attr("class", "treelink")
                    .attr("fill", "none")
                    .attr("d", elbow);

                const rLinkExit = rLinkUpdate.exit()
                    .call(exit => exit.transition(tranz)
                        .attr("fill-opacity", 0)
                        .attr("stroke-opacity", 0)
                        .attr("height", 0)
                        .remove()
                    );

                const nodeSize = function (d) {
                    if (d.data.collapsed)
                        return 6;
                    else
                        return d.children ? 2 : 1.5
                }

                const order = isRow ? rowClusters.order : colClusters.order;
                //nodes    
                const rNodeUpdate = treeGroup.selectAll(".treenode")
                    .data(tree.descendants())
                    .attr("transform", function (d) {
                        return "translate(" + d.y + "," + d.x + ")";
                    })
                    // .attr("r", nodeSize)
                    .on("mouseover", function (event, d) {
                        nodeMouseOver(d3.select(this), order, event, d, isRow);
                    }).on("mouseout", function (event, d) {
                        nodeMouseOut(d3.select(this), event, isRow);
                    }).on("click", function (event, d) {
                        nodeClicked(d3.select(this), rowClusters, colClusters, event, d, isRow, colorScale);
                    });;

                const rNodeEnter = rNodeUpdate.enter().append("circle")
                    .attr("class", "treenode")
                    .attr("transform", function (d) {
                        return "translate(" + d.y + "," + d.x + ")";
                    })
                    .attr("r", nodeSize)
                    .on("mouseover", function (event, d) {
                        nodeMouseOver(d3.select(this), order, event, d, isRow);
                    }).on("mouseout", function (event, d) {
                        nodeMouseOut(d3.select(this), event, isRow);
                    }).on("click", function (event, d) {
                        nodeClicked(d3.select(this), rowClusters, colClusters, event, d, isRow, colorScale);
                    });

                rNodeUpdate.exit().call(exit => exit.transition(tranz)
                    .attr("opacity", 0)
                    .attr('r', 1e-6)
                    .remove());
            }


            /************      tree for rows   *************/
            const rTreeG = svg.select("#rtree")
                .attr("transform", "translate (10, " + (treeWidth + cellSize) + ")");
            drawTree(rTreeG, rowsTree, true)

            //tree for cols
            let cTree = svg.select("#ctree")
                .attr("transform", "rotate (90), translate (10, -" + (treeWidth + cellSize) + ") scale(1,-1)");
            drawTree(cTree, colsTree, false)

            function elbow(d, i) {
                return "M" + d.source.y + "," + d.source.x
                    + "V" + d.target.x + "H" + d.target.y;
            }
        }


        const clusterByAndDisplay = function (data, rowname, colname, propname, colorschema, duplicatesMode, filters) {
            emptyMsgDiv.html("")

            // get data using accessor
            valueMatrix = getValueMatrix(data, rowname, colname, propname, duplicatesMode, filters)

            let cs = colorschema ? colorschema : d3.interpolateGreens;
            let colorScale = d3.scaleSequential(valueMatrix.extent, cs);

            // const numClusters = 3;
            // let links = this.clusterKmeans(links, numClusters);

            // cluster rows and columns
            let rowClusters = hcluster(valueMatrix.rowMatrix);
            console.log(rowClusters)

            let colClusters = hcluster(valueMatrix.colMatrix);
            console.log(colClusters)

            // update trees - for each node add reordered data array
            reorderTreeData(rowClusters, colClusters.order, data.rowLabels)
            reorderTreeData(colClusters, rowClusters.order, data.colLabels)

            heatmapDendro(rowClusters, colClusters, colorScale)
        }

        const termsSplitre = /[\t\n\s]+/;
        const search = function (text, rowsmode = true) {

            const selector = rowsmode ? ".rowLabel" : ".colLabel";

            if (!text.length) {
                d3.selectAll(selector)
                    .classed("matched", false);
                return;
            }

            const terms = text.split(termsSplitre);
            console.log(terms)

            d3.selectAll(selector)
                .classed("matched", function (d, i) {
                    // d is the text node content
                    let found = false;
                    terms.forEach((t) => { if (d.data.label.indexOf(t) >= 0) found = true })
                    return found;
                });
        }

        const initControls = function (headers) {
            if (d3.selectAll("#d3tooltip").empty()) {
                d3.select("body")
                    .append("div")
                    .attr("id", "d3tooltip")
                    .append("p")
                    .attr("id", "tooltipvalue")
            }

            const numHeaders = headers.filter(h => h.isNumeric);

            // rows controls
            let rowsCtl = topControls.append("div").attr("class", "");
            rowsCtl.append("label").attr("for", "rowLabelSelect").html("Matrix row labels: ")

            let rowLabelInput = rowsCtl
                .append("select").attr("id", "rowLabelSelect");
            rowLabelInput.selectAll("option")
                .data(headers)
                .enter().append("option")
                .attr("value", function (d) {
                    return d.label;
                })
                .text(function (d) {
                    return d.label;
                })
                .property("selected", function (d) { return d.label === "qacc" });

            // cols controls
            let colsCtl = topControls.append("div");
            colsCtl.append("label").attr("for", "colLabelSelect").html("Matrix column labels: ")

            let colLabelInput = colsCtl
                .append("select").attr("id", "colLabelSelect");
            colLabelInput.selectAll("option")
                .data(headers)
                .enter().append("option")
                .attr("value", function (d) {
                    return d.label;
                })
                .text(function (d) {
                    return d.label;
                })
                .property("selected", function (d) { return d.label === "species" });

            // cluster controls
            let clusterCtl = topControls.append("div");
            clusterCtl.append("label").attr("for", "closterLabelSelect").html("Matrix data (numeric only):")

            let clusterLabelInput = clusterCtl
                .append("select").attr("id", "clusterLabelSelect");
            clusterLabelInput.selectAll("option")
                .data(numHeaders)
                .enter().append("option")
                .attr("value", function (d) {
                    return d.label;
                })
                .text(function (d) {
                    return d.label;
                })
                .property("selected", function (d) { return d.label === "pident" });;

            // duplicate mode
            const dupModes = [
                { label: "Keep first", value: "first" },
                { label: "Keep last", value: "last" },
                { label: "Keep min", value: "min" },
                { label: "Keep max", value: "max" }
            ];

            let duplCtl = topControls.append("div");
            duplCtl.append("label").attr("for", "duplSelect").html("Duplicates mode:")

            let duplicatesModeInput = duplCtl
                .append("select").attr("id", "duplSelect");
            duplicatesModeInput.selectAll("option")
                .data(dupModes)
                .enter().append("option")
                .attr("value", function (d) {
                    return d.value;
                })
                .text(function (d) {
                    return d.label;
                });

            // coloring  controls
            let colorCtl = topControls.append("div");
            colorCtl.append("label").attr("for", "colorSelect").html("Coloring:")
            let colorLabelInput = colorCtl
                .append("select").attr("id", "colorSelect");

            const colorSchemas = [
                //single color
                { label: "Green", value: d3.interpolateGreens },
                { label: "Orange", value: d3.interpolateOranges },
                { label: "Blue", value: d3.interpolateBlues },
                // { label: "Green", value: d3.interpolateGreens },
                { label: "Gray", value: d3.interpolateGreys },
                { label: "Purple", value: d3.interpolatePurples },
                { label: "Red", value: d3.interpolateReds },


                { label: "Red -> Yellow -> Green", value: d3.interpolateRdYlGn },
                { label: "Brown -> BlueGreen", value: d3.interpolateBrBG },
                { label: "Purple -> Green", value: d3.interpolatePRGn },
                { label: "Pink -> YellowGreen", value: d3.interpolatePiYG },
                { label: "Purple -> Orange", value: d3.interpolatePuOr },

                { label: "Red -> Blue", value: d3.interpolateRdBu },
                { label: "Red -> Yellow -> Blue", value: d3.interpolateRdYlBu },
                { label: "Spectral", value: d3.interpolateSpectral },


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


            const filterOptions = ["--", ">", ">=", "<", "<="];


            let filtersDiv = topControls.append("div").attr("class", "filters-container");
            filtersDiv.append("div").attr("style", "grid-row: row /span 2;")
                .html("Apply filters:<br>\"--\" means no filtering");

            numHeaders.forEach((h, i) => {
                let selDiv = filtersDiv.append("div").attr("class", "filter");
                selDiv.append("label").attr("for", `filtersel_${i}`).html(h.label);

                let filterSel = selDiv.append("select")
                    .attr("id", `filtersel_${i}`)
                    .attr("filter-for", h.label);
                filterSel.selectAll("option")
                    .data(filterOptions)
                    .enter()
                    .append("option")
                    .attr("value", function (d, i) {
                        return d;
                    })
                    .text(function (d) {
                        return d;
                    });

                selDiv.append("input").attr("type", "number").attr("id", `filterinp_${i}`).attr("filter-value-for", h.label);
            });

            const getFilters = function () {
                let selects = filtersDiv.selectAll("select");
                const filters = {
                    //"pident": { mode: ">", value: 70 }
                }
                selects.each(function () {
                    let mode = this.value;
                    if (mode != "--") {
                        let k = this.getAttribute("filter-for");
                        let inp = filtersDiv.selectAll(`input[filter-value-for='${k}']`)
                        if (inp) {
                            let d = +inp.node().value.trim()
                            filters[k] = { mode: mode, value: d }
                        }
                    }
                })
                console.log("Filters:");
                console.log(filters);
                return filters;
            }


            let errorrDiv = topControls.append("div").attr("class", "errors");

            topControls.append("button")
                .attr("id", "displayButton")
                .attr("class", "button")
                .text("DISPLAY")
                .on("click", function () {
                    errorrDiv.html("");
                    dendroControls.property("hidden", false);
                    let rowLb = rowLabelInput.node().value;
                    let colLb = colLabelInput.node().value;
                    let clsLb = clusterLabelInput.node().value;
                    let duplLb = duplicatesModeInput.node().value;

                    if (rowLb === colLb || colLb === clsLb || rowLb === clsLb) {
                        errorrDiv.html("Selected values should be different")
                    } else {
                        let colr = colorSchemas[colorLabelInput.node().value].value;
                        let data = parseData(textdata, headers, rowLb, colLb, clsLb);
                        // console.log(data)
                        console.log(`Parsed [${data.rowLabels.length} x ${data.colLabels.length}] matrix
                        with ${data.headers.length - 2} value sets`);

                        clusterByAndDisplay(data, rowLb, colLb, clsLb, colr, duplLb, getFilters())
                    }
                });


            // search controls
            let rowsSearch = dendroControls.append("div");
            rowsSearch.append("label").attr("for", "rowSearchText").html("Search rows for:")

            let rsText = rowsSearch.append('textarea')
                .attr('type', 'text')
                .attr('name', 'rowSearchText');

            dendroControls.append("div").append("button")
                .attr("class", "button")
                .text("Search rows")
                .on("click", function () {
                    const text = rsText.node().value.trim();
                    search(text, true);
                });

            let colsSearch = dendroControls.append("div");
            colsSearch.append("label").attr("for", "colSearchText").html("Search columns for:")

            let csText = colsSearch.append('textarea')
                .attr('type', 'text')
                .attr('name', 'colSearchText');

            dendroControls.append("div").append("button")
                .attr("class", "button")
                .text("Search columns")
                .on("click", function () {
                    const text = csText.node().value.trim();
                    search(text, false);
                });
        }

        let headers = parseHeaders(textdata)
        initSvgElements();
        initControls(headers);
    }

})();