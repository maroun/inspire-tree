'use strict';

// Libs
var cloneDeep = require('lodash.cloneDeep');
var cuid = require('cuid');
var each = require('lodash.foreach');
var isArray = require('lodash.isarray');
var isEmpty = require('lodash.isempty');
var isFunction = require('lodash.isfunction');
var map = require('lodash.map');
var transform = require('lodash.transform');

module.exports = function InspireData(api) {
    /**
     * Parses a raw collection of objects into a model used
     * within a tree. Adds state and other internal properties.
     *
     * @param {array|object} collection Collection of nodes
     * @param {object} parent Pointer to parent object
     * @return {array|object} Object model.
     */
    function collectionToModel(collection, parent) {
        map(collection, function(node) {
            objectToModel(node, parent);
        });

        return collection;
    };

    /**
     * Generates a unique ID. Useful for generating keys
     * for nodes if source data doesn't define one.
     *
     * @return {string} Unique ID.
     */
    function generateId() {
        return cuid();
    };

    /**
     * Merge a node into an existing context - a model
     * or another node's children. If the ID exists
     * the node is skipped and we try its children.
     *
     * @param {array} context Array of node objects.
     * @param {object} node Node object.
     * @return {array} Array of new nodes.
     */
    var mergeNode = function(context, node) {
        var newNodes = [];

        if (node.id) {
            // Does node already exist
            var existing = data.getNodeById(node.id);
            if (existing) {
                existing.itree.state.hidden = false;

                // Ensure existing accepts children
                if (!isArray(existing.children)) {
                    existing.children = [];
                }

                each(node.children, function(child) {
                    newNodes.concat(mergeNode(existing.children, child));
                });
            }
            else {
                context.push(node);
                newNodes.push(node);
            }
        }

        return newNodes;
    };

    /**
     * Parse a raw object into a model used within a tree.
     *
     * @param {object} object Source object
     * @param {object} parent Pointer to parent object.
     * @return {object} Final object
     */
    function objectToModel(object, parent) {
        object.id = object.id || generateId();
        object.parent = parent;

        if (!object.itree) {
            object.itree = {
                state: {
                    collapsed: true,
                    hidden: false,
                    selected: false
                }
            };
        }

        if (isArray(object.children) && !isEmpty(object.children)) {
            collectionToModel(object.children, object);
        }

        return object;
    };

    /**
     * Iterate nodes recursively.
     *
     * @param {array} array Node array.
     * @param {function} iteratee Iteratee function.
     * @return {array} Resulting node array.
     */
    function recurse(array, iteratee) {
        each(array, function(item, key) {
            array[key] = iteratee(item, key);

            if (isArray(item.children) && !isEmpty(item.children)) {
                item.children = recurse(item.children, iteratee);
            }
        });

        return array;
    };

    var batching = false;
    var rerender = function() {
        // Never rerender when until batch complete
        if (batching) {
            return;
        }

        api.dom.renderNodes(model);
    };

    var data = this;
    var model = [];

    /**
     * Add a node.
     *
     * @param {object} node Node object.
     * @return {object} Node object.
     */
    data.addNode = function(node) {
        node = objectToModel(node);
        var newNodes = mergeNode(model, node);

        if (newNodes.length) {
            api.events.emit('node.added', node);
            rerender();
        }

        return node;
    };

    /**
     * Add nodes.
     *
     * @param {array} nodes Array of node objects.
     * @return {array} Added node objects.
     */
    data.addNodes = function(nodes) {
        data.batch();

        transform(nodes, function(newNodes, node) {
            newNodes.push(data.addNode(node));
        });

        data.end();

        return nodes;
    };

    /**
     * Disable rendering in preparation for multiple changes.
     *
     * @return {void}
     */
    data.batch = function() {
        batching = true;
    };

    /**
     * Expand immediate children for this node, if any.
     *
     * @param {object} node Node object.
     * @return {object} Node object.
     */
    data.collapseNode = function(node) {
        if (!node.itree.state.collapsed) {
            node.itree.state.collapsed = true;

            api.events.emit('node.collapsed', node);

            rerender();
        }

        return node;
    };

    /**
     * Deselect all nodes.
     *
     * @return {void}
     */
    data.deselectAll = function() {
        data.batch();
        recurse(model, data.deselectNode);
        data.end();
    };

    /**
     * Deselect a node.
     *
     * @param {object} node Node object.
     * @return {pbject} Node object.
     */
    data.deselectNode = function(node) {
        if (node.itree.state.selected) {
            node.itree.state.selected = false;

            api.events.emit('node.deselected', node);

            rerender();
        }

        return node;
    };

    /**
     * Permit rerendering of batched changes.
     *
     * @return {void}
     */
    data.end = function() {
        batching = false;
        rerender();
    };

    /**
     * Expand immediate children for this node, if any.
     *
     * @param {object} node Node object.
     * @return {object} Node object.
     */
    data.expandNode = function(node) {
        if (node.itree.state.collapsed) {
            node.itree.state.collapsed = false;

            api.events.emit('node.expanded', node);

            rerender();
        }

        return node;
    };

    /**
     * Flattens a hierarchy, returning only node(s) with the
     * expected state, for operations which must exclude parents.
     *
     * @param {array} nodes Array of node objects.
     * @param {string} flag Which state flag to filter by.
     * @return {array} Flat array of matching nodes.
     */
    data.flatten = function(nodes, flag) {
        var flat = [];
        flag = flag || 'selected';

        if (isArray(nodes) && !isEmpty(nodes)) {
            each(nodes, function(node) {
                if (node.itree.state[flag]) {
                    flat.push(node);
                }
                else {
                    flat = flat.concat(data.flatten(node.children));
                }
            });
        }

        return flat;
    };

    /**
     * Returns a flat array of selected nodes.
     *
     * If `hierarchy` is false, it'll returned selected nodes
     * along with their parents. However, the data will be cloned
     * to prevent conflicts with original data.
     *
     * @param {array} nodes Array of node objects to search within.
     * @param {boolean} hierarchy Whether to return a hierarchy or flat array.
     * @return {array} Selected nodes.
     */
    data.getSelected = function(nodes, hierarchy) {
        var selected = [];

        if (!hierarchy) {
            selected = data.flatten((nodes || model), 'selected');
        }
        else {
            each((nodes || model), function(node) {
                var nodeClone;

                if (node.itree.state.selected) {
                    nodeClone = cloneDeep(node);
                }

                // Are any children selected?
                if (!nodeClone && isArray(node.children) && node.children.length) {
                    var children = data.getSelected(node.children, hierarchy);
                    if (children.length) {
                        nodeClone = cloneDeep(node);
                        nodeClone.children = children;
                    }
                }

                if (nodeClone) {
                    nodeClone.itree = null;

                    recurse(nodeClone.children, function(elem, key) {
                        return (key === 'itree' ? null : elem);
                    });

                    selected.push(nodeClone);
                }
            });
        }

        return selected;
    };

    /**
     * Get a node by it's unique id.
     *
     * @param {string} id Unique ID.
     * @param {array} nodes Base collection to search in.
     * @return {object} Found node.
     */
    data.getNodeById = function(id, nodes) {
        var node;

        each((nodes || model), function(item) {
            if (item.id === id) {
                node = item;
            }

            if (!node && isArray(item.children) && !isEmpty(item.children)) {
                node = data.getNodeById(id, item.children);
            }

            if (node) {
                return false;
            }
        });

        return node;
    };

    /**
     * Hide a node.
     *
     * @param {object} node Node object.
     * @return {object} Node object.
     */
    data.hideNode = function(node) {
        if (!node.itree.state.hidden) {
            node.itree.state.hidden = true;

            api.events.emit('node.hidden', node);

            rerender();
        }

        return node;
    };

    /**
     * Hide all nodes in an array.
     *
     * @param {array} nodes Array of node objects.
     * @return {array} Array of node objects.
     */
    data.hideNodes = function(nodes) {
        data.batch();
        each(nodes, data.hideNode);
        data.end();
        return nodes;
    };

    /**
     * Loads data. Accepts an array or a promise.
     *
     * @param {array|function} loader Array of nodes, or promise resolving an array of nodes.
     * @return {object} Promise
     * @example
     *
     * data.load($.getJSON('nodes.json'));
     */
    data.load = function(loader) {
        return new Promise(function(resolve, reject) {
            if (isArray(loader)) {
                model = collectionToModel(loader);
                resolve(model);
            }

            else if (typeof loader === 'object') {
                // Promise
                if (isFunction(loader.then)) {
                    loader.then(function(results) {
                        model = collectionToModel(results);
                        resolve(model);
                    });
                }

                // jQuery promises use "error".
                if (isFunction(loader.error)) {
                    loader.error(reject);
                }
                else if (isFunction(loader.catch)) {
                    loader.catch(reject);
                }
            }
        });
    };

    /**
     * Select a node. If already selected, no change made.
     *
     * @param {object} node Node object.
     * @return {object} Node object.
     */
    data.selectNode = function(node) {
        if (!node.itree.state.selected) {
            data.deselectAll();

            node.itree.state.selected = true;

            api.events.emit('node.selected', node);

            rerender();
        }

        return node;
    };

    /**
     * Hide a node.
     *
     * @param {object} node Node object.
     * @return {object} Node object.
     */
    data.showNode = function(node) {
        if (node.itree.state.hidden) {
            node.itree.state.hidden = false;

            api.events.emit('node.shown', node);

            rerender();
        }

        return node;
    };

    return data;
};